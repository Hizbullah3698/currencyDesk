import { customerLedger, currencyMeta, type Account, type Activity, type Cheque, type JournalEntry, type LedgerRow } from './engine'
import { shortRef } from './format'
import { statementRange } from './statementRange'
import { STATEMENT_CONFIG, type AmountDecimals } from './statementConfig'
import { assertPdfSafeLiteral, pdfText, type TextWarning } from './pdfText'
import { formatRate, formatUnits, rupeesToPaisa, type Paisa } from './statementMoney'

// ---------------------------------------------------------------------------
// The customer statement, as a plain document — before any PDF exists
// ---------------------------------------------------------------------------
//
// This builds WHAT the statement says; statementPdf.ts only decides where it goes on the page. Keeping
// them apart is what makes the statement testable without a browser or a PDF: everything that could be
// wrong about the numbers is wrong (or right) here, in plain data.
//
// READS ONLY WHAT THE STATEMENT ALREADY READS. The rows come from `customerLedger`, the same function
// the on-screen statement and the Excel export use, so the three cannot disagree. Nothing here reads
// `cost` or `margin` from any record — not to display it, not to compute with it — so an operator's
// statement is built from exactly the same fields and carries nothing about profit. A test feeds an
// admin-shaped snapshot (cost and margin populated) and checks that neither the figures nor the words
// appear anywhere in the document.
//
// EVERY AMOUNT IS WHOLE PAISA. Floats from the ledger are converted once (statementMoney.ts) and
// everything after is integer arithmetic, so the columns add up on paper.

// --- The words WE write. Checked at load: a character the PDF font cannot print throws right here. ---
const W = {
  sale: assertPdfSafeLiteral('Sale'),
  purchase: assertPdfSafeLiteral('Purchase'),
  received: assertPdfSafeLiteral('Payment received'),
  made: assertPdfSafeLiteral('Payment made'),
  cheque: assertPdfSafeLiteral('Cheque cleared'),
  transferTo: assertPdfSafeLiteral('Transfer to'),
  transferFrom: assertPdfSafeLiteral('Transfer from'),
  journal: assertPdfSafeLiteral('Journal entry'),
  sep: assertPdfSafeLiteral(' · '), // middle dot: in Latin-1, so the standard font prints it
  soldToCustomer: assertPdfSafeLiteral('Sold to customer'),
  boughtFromCustomer: assertPdfSafeLiteral('Bought from customer'),
  evenWithCustomer: assertPdfSafeLiteral('Nothing outstanding'),
  chequeIn: assertPdfSafeLiteral('Received (in)'),
  chequeOut: assertPdfSafeLiteral('Issued (out)'),
} as const

export const STATEMENT_WORDS = W

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-19' -> '19 Sep 2026'. Unambiguous whichever side of the world reads it. */
export function pdfDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? '?'} ${y}`
}

const two = (n: number) => String(n).padStart(2, '0')
const localISO = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`

// --- The document ---

export interface StatementEntry {
  /**
   * The row's words as ONE line: `type` + `joiner` + `detail`. Kept whole so anything that reads the words
   * (a test, a text search) sees exactly what is printed.
   */
  description: string
  /** What kind of row it is — "Sale", "Payment received", "Transfer to", or a journal entry's narration. Drawn bold. */
  type: string
  /** What follows the type — "500 AED @ 80", "Cash", the other customer's name. Drawn grey. May be empty. */
  detail: string
  /** What sits between them: the middle dot for a deal or payment, a plain space for a transfer or reference. */
  joiner: string
  /** The deal, payment, cheque or voucher reference, as the Transactions page shows it. */
  ref: string
  /** Paisa. 0 means "blank cell". */
  debit: Paisa
  credit: Paisa
  /** The running balance AFTER this entry: positive Dr, negative Cr. */
  balance: Paisa
}

export interface StatementDateGroup {
  /** 'YYYY-MM-DD' */
  date: string
  label: string
  entries: StatementEntry[]
}

export interface StatementPendingCheque {
  direction: 'in' | 'out'
  directionLabel: string
  number: string
  bank: string
  dueLabel: string
  status: string
  amount: Paisa
}

export interface StatementPosition {
  code: string
  side: 'sold' | 'bought' | 'even'
  sideLabel: string
  /** Absolute units of the currency. */
  units: number
  unitsLabel: string
  /** Absolute rupee value, paisa. */
  value: Paisa
}

export interface StatementDocument {
  deskName: string
  title: string
  customerName: string
  /** The short account id: the same 8-character form the Transactions page uses for references. */
  accountId: string
  periodFrom: string
  periodTo: string
  generatedAt: string
  decimals: AmountDecimals

  /** Signed net, paisa: positive Dr, negative Cr. */
  opening: Paisa
  totalDebits: Paisa
  totalCredits: Paisa
  closing: Paisa

  groups: StatementDateGroup[]
  entryCount: number

  pendingCheques: StatementPendingCheque[]
  pendingIn: Paisa
  pendingOut: Paisa

  positions: StatementPosition[]

  /** Text that had to be changed to print. Empty when nothing was. */
  warnings: TextWarning[]
}

export interface StatementSource {
  customer: Account
  accounts: Account[]
  activity: Activity[]
  cheques: Cheque[]
  journalEntries: JournalEntry[]
}

export interface StatementOptions {
  /** 'YYYY-MM-DD' or '' — blank means "from the beginning". */
  from?: string
  /** 'YYYY-MM-DD' or '' — blank means "up to now". */
  to?: string
  now?: Date
  /** Override for tests; production reads STATEMENT_CONFIG. */
  decimals?: AmountDecimals
  deskName?: string
}

/** The statement did not add up. Never printed — a customer must not be handed a statement that does not foot. */
export class StatementIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatementIntegrityError'
  }
}

export function buildStatementDocument(src: StatementSource, opts: StatementOptions = {}): StatementDocument {
  const decimals = opts.decimals ?? STATEMENT_CONFIG.amountDecimals
  const now = opts.now ?? new Date()
  const from = opts.from ?? ''
  const to = opts.to ?? ''
  const warnings: TextWarning[] = []
  const cust = src.customer

  const ledger = customerLedger(cust, src.activity, src.cheques, src.journalEntries, statementRange(from, to))

  const accountById = new Map(src.accounts.map((a) => [a.id, a]))
  const activityById = new Map(src.activity.map((a) => [a.id, a]))
  const chequeById = new Map(src.cheques.map((q) => [q.id, q]))
  const entryById = new Map(src.journalEntries.map((e) => [e.id, e]))

  // --- describe one ledger row: words + reference, from stored fields only ---
  function describe(row: LedgerRow): { type: string; detail: string; joiner: string; ref: string } {
    switch (row.type) {
      case 'sale':
      case 'purchase': {
        const code = pdfText(row.currency ?? 'AED', 'Currency code', warnings)
        const meta = currencyMeta(row.currency)
        const units = formatUnits(row.amount ?? 0, meta.amountDecimals)
        const rate = formatRate(row.rate ?? 0, meta.rateDecimals)
        const verb = row.type === 'sale' ? W.sale : W.purchase
        return { type: verb, detail: `${units} ${code} @ ${rate}`, joiner: W.sep, ref: shortRef(row.id) }
      }
      case 'receive':
      case 'pay': {
        const act = activityById.get(row.id)
        const verb = row.type === 'receive' ? W.received : W.made
        let how = act?.method ?? ''
        if (act?.method === 'Bank') {
          const acct = act.settlementAccountId ? accountById.get(act.settlementAccountId) : undefined
          how = pdfText(acct?.name ?? 'Bank', 'Bank account name', warnings)
        } else how = pdfText(how, 'Payment method', warnings)
        return { type: verb, detail: how, joiner: W.sep, ref: shortRef(row.id) }
      }
      case 'cheque': {
        const q = chequeById.get(row.id)
        const number = pdfText(q?.number ?? '', `Cheque number (${shortRef(row.id)})`, warnings)
        const bank = pdfText(q?.bank ?? '', `Cheque bank (cheque ${number || shortRef(row.id)})`, warnings)
        const who = [bank, number].filter(Boolean).join(' ')
        return { type: W.cheque, detail: who, joiner: W.sep, ref: shortRef(row.id) }
      }
      default: {
        // 'journal': a manual entry or a customer-to-customer transfer.
        const e = entryById.get(row.id)
        if (!e) return { type: W.journal, detail: '', joiner: ' ', ref: shortRef(row.id) }
        const ref = pdfText(e.ref, 'Journal reference', warnings)
        const debitAcct = accountById.get(e.debitAccount)
        const creditAcct = accountById.get(e.creditAccount)
        if (debitAcct?.type === 'Customer' && creditAcct?.type === 'Customer') {
          // The transfer screen debits the sender and credits the receiver, so this customer being the
          // debited leg means the money went TO the other one, and the credited leg means it came FROM them.
          const thisIsDebit = e.debitAccount === cust.id
          const other = pdfText(thisIsDebit ? e.creditLabel : e.debitLabel, `Customer name on transfer ${ref}`, warnings)
          return { type: thisIsDebit ? W.transferTo : W.transferFrom, detail: other, joiner: ' ', ref }
        }
        const narration = pdfText(e.narration, `Entry narration ${ref}`, warnings)
        // A narration IS the type: it is the words the person wrote for the entry, and there is nothing to follow it.
        return narration ? { type: narration, detail: '', joiner: ' ', ref } : { type: W.journal, detail: ref, joiner: ' ', ref }
      }
    }
  }

  // --- rows, in integer paisa ---
  const opening: Paisa = rupeesToPaisa(ledger.opening.receivable) - rupeesToPaisa(ledger.opening.payable)
  let running = opening
  let totalDebits: Paisa = 0
  let totalCredits: Paisa = 0
  const groups: StatementDateGroup[] = []
  let entryCount = 0

  for (const row of ledger.rows) {
    // The NET effect of the row. Receivable and payable are converted separately and subtracted in
    // paisa, so an allocation that moves both columns (an over-covering cheque, a crossing entry) is
    // exact rather than a difference of two floats.
    const delta: Paisa = rupeesToPaisa(row.receivableDelta) - rupeesToPaisa(row.payableDelta)

    // A payment taken by cheque that has not cleared moves nothing: it appears on the statement on the
    // day it clears. Printing it here with two empty amount cells would be a row that does nothing, so it
    // is left to the "pending cheques" box, which is where a reader looks for it.
    if (delta === 0 && (row.type === 'receive' || row.type === 'pay') && activityById.get(row.id)?.chequeHeld) continue

    running += delta
    const debit = delta > 0 ? delta : 0
    const credit = delta < 0 ? -delta : 0
    totalDebits += debit
    totalCredits += credit

    const { type, detail, joiner, ref } = describe(row)
    const description = detail ? `${type}${joiner}${detail}` : type
    let group = groups[groups.length - 1]
    if (!group || group.date !== row.date) {
      group = { date: row.date, label: pdfDate(row.date), entries: [] }
      groups.push(group)
    }
    group.entries.push({ description, type, detail, joiner, ref, debit, credit, balance: running })
    entryCount++
  }

  // --- THE IDENTITY. opening + debits - credits = closing, and the running balance ended where the
  // ledger says it ended. Both hold by construction; asserted anyway, because the one thing this
  // document must never do is hand a customer a statement that does not add up. ---
  const closing: Paisa = rupeesToPaisa(ledger.closing.receivable) - rupeesToPaisa(ledger.closing.payable)
  if (opening + totalDebits - totalCredits !== closing) {
    throw new StatementIntegrityError(`Statement does not add up: opening ${opening} + debits ${totalDebits} - credits ${totalCredits} is ${opening + totalDebits - totalCredits} paisa, but the ledger closes at ${closing}.`)
  }
  if (running !== closing) {
    throw new StatementIntegrityError(`Statement running balance ended at ${running} paisa, but the ledger closes at ${closing}.`)
  }

  // --- pending (uncleared) cheques, as at now. They do not touch the balance until they clear. ---
  const pendingCheques: StatementPendingCheque[] = src.cheques
    .filter((q) => q.customerId === cust.id && (q.status === 'Pending' || q.status === 'Deposited'))
    .sort((a, b) => a.due.localeCompare(b.due) || a.createdAt.localeCompare(b.createdAt))
    .map((q) => {
      const number = pdfText(q.number, `Cheque number (${shortRef(q.id)})`, warnings)
      return {
        direction: q.direction === 'Inward' ? ('in' as const) : ('out' as const),
        directionLabel: q.direction === 'Inward' ? W.chequeIn : W.chequeOut,
        number,
        bank: pdfText(q.bank, `Cheque bank (cheque ${number || shortRef(q.id)})`, warnings),
        dueLabel: q.due ? pdfDate(q.due) : '-',
        status: q.status,
        amount: rupeesToPaisa(q.amount),
      }
    })
  const pendingIn = pendingCheques.filter((q) => q.direction === 'in').reduce((s, q) => s + q.amount, 0)
  const pendingOut = pendingCheques.filter((q) => q.direction === 'out').reduce((s, q) => s + q.amount, 0)

  // --- per-currency position, in plain words rather than signed numbers. `units` is purchases less
  // sales: positive means the desk took in more of the currency from this customer than it gave back. ---
  const positions: StatementPosition[] = ledger.currencies.map((c) => {
    const meta = currencyMeta(c.code)
    const side = c.units > 0 ? 'bought' : c.units < 0 ? 'sold' : 'even'
    return {
      code: pdfText(c.code, 'Currency code', warnings),
      side,
      sideLabel: side === 'bought' ? W.boughtFromCustomer : side === 'sold' ? W.soldToCustomer : W.evenWithCustomer,
      units: Math.abs(c.units),
      unitsLabel: formatUnits(c.units, meta.amountDecimals),
      value: Math.abs(rupeesToPaisa(c.pkr)),
    }
  })

  // --- period: the requested bounds, else what the statement actually covers ---
  const firstDate = ledger.rows[0]?.date
  const periodFrom = from ? pdfDate(from) : firstDate ? pdfDate(firstDate) : '-'
  const periodTo = to ? pdfDate(to) : pdfDate(localISO(now))

  return {
    deskName: pdfText(opts.deskName ?? STATEMENT_CONFIG.deskName, 'Desk name', warnings),
    title: STATEMENT_CONFIG.title,
    customerName: pdfText(cust.name, 'Customer name', warnings),
    accountId: shortRef(cust.id),
    periodFrom,
    periodTo,
    generatedAt: `${pdfDate(localISO(now))}, ${two(now.getHours())}:${two(now.getMinutes())}`,
    decimals,
    opening,
    totalDebits,
    totalCredits,
    closing,
    groups,
    entryCount,
    pendingCheques,
    pendingIn,
    pendingOut,
    positions,
    warnings,
  }
}
