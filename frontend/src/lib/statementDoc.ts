import { customerLedger, currencyMeta, type Account, type Activity, type Cheque, type JournalEntry, type LedgerRow } from './engine'
import { shortRef } from './format'
import { statementRange } from './statementRange'
import { STATEMENT_CONFIG, type AmountDecimals } from './statementConfig'
import { assertPdfSafeLiteral, pdfText, type TextWarning } from './pdfText'
import { formatPaisa, formatRate, formatUnits, rupeesToPaisa, splitBalance, type Paisa } from './statementMoney'

// ---------------------------------------------------------------------------
// The customer statement, as a plain document — before any PDF exists
// ---------------------------------------------------------------------------
//
// This builds WHAT the statement says; statementPdf.ts only decides where it goes on the page. Keeping
// them apart is what makes the statement testable without a browser or a PDF: everything that could be
// wrong about the numbers or the words is wrong (or right) here, in plain data.
//
// READS ONLY WHAT THE STATEMENT ALREADY READS. The rows come from `customerLedger`, the same function
// the on-screen statement and the Excel export use, so the three cannot disagree — same rows, same order,
// same running balance. Nothing here reads `cost` or `margin` from any record — not to display it, not
// to compute with it — so an operator's statement is built from exactly the same fields and carries
// nothing about profit. A test feeds an admin-shaped snapshot (cost and margin populated) and checks that
// neither the figures nor the words appear anywhere in the document.
//
// EVERY AMOUNT IS WHOLE PAISA. Floats from the ledger are converted once (statementMoney.ts) and
// everything after is integer arithmetic, so the columns add up on paper.
//
// THE SIGN CONVENTION, traced rather than assumed: `customerLedger`'s runningNet is receivable − payable,
// so a POSITIVE net is Dr — the customer owes the business — and a NEGATIVE net is Cr — the business owes
// the customer. A sale to the customer is a debit (it adds to what they owe); a purchase from them, and
// money received from them, are credits. Every plain-language label below is derived from that one rule.
//
// THE WORDING is from the business's side throughout ("Sold to customer", "Cash received from customer"),
// and says only what the record supports: a manual journal entry keeps the narration the person wrote,
// and a transfer names the other customer exactly as the entry records them.

// --- The words WE write. Checked at load: a character the PDF font cannot print throws right here. ---
const W = {
  soldToCustomer: assertPdfSafeLiteral('Sold to customer'),
  boughtFromCustomer: assertPdfSafeLiteral('Bought from customer'),
  rate: assertPdfSafeLiteral('Rate'),
  per: assertPdfSafeLiteral('per'),
  sep: assertPdfSafeLiteral(' · '), // middle dot: in Latin-1, so the font has it
  /** No-break space: keeps a currency code on the same line as its amount when a description wraps. */
  nbsp: assertPdfSafeLiteral(' '),
  cashReceived: assertPdfSafeLiteral('Cash received from customer'),
  bankReceived: assertPdfSafeLiteral('Bank payment received from customer'),
  chequeReceived: assertPdfSafeLiteral('Cheque payment received from customer'),
  otherReceived: assertPdfSafeLiteral('Payment received from customer'),
  cashPaid: assertPdfSafeLiteral('Cash paid to customer'),
  bankPaid: assertPdfSafeLiteral('Bank payment to customer'),
  chequePaid: assertPdfSafeLiteral('Cheque payment to customer'),
  otherPaid: assertPdfSafeLiteral('Payment to customer'),
  via: assertPdfSafeLiteral('Via'),
  chequeInCleared: assertPdfSafeLiteral('Cheque received from customer, cleared'),
  chequeOutCleared: assertPdfSafeLiteral('Cheque issued to customer, cleared'),
  chequeNo: assertPdfSafeLiteral('Cheque no.'),
  transferTo: assertPdfSafeLiteral('Transfer to'),
  transferFrom: assertPdfSafeLiteral('Transfer from'),
  journal: assertPdfSafeLiteral('Journal entry'),
  dealValue: assertPdfSafeLiteral('Deal value'),
  settledAtTime: assertPdfSafeLiteral('settled at the time'),
  opening: assertPdfSafeLiteral('Opening balance'),
  noEntries: assertPdfSafeLiteral('No transactions in this period.'),
  payable: assertPdfSafeLiteral('Amount payable to customer'),
  receivable: assertPdfSafeLiteral('Amount receivable from customer'),
  settled: assertPdfSafeLiteral('Account settled — no outstanding balance'),
  chequeIn: assertPdfSafeLiteral('Received from customer'),
  chequeOut: assertPdfSafeLiteral('Issued to customer'),
  netBought: assertPdfSafeLiteral('net bought'),
  netSold: assertPdfSafeLiteral('net sold'),
  netBoughtFrom: assertPdfSafeLiteral('Net bought from customer'),
  netSoldTo: assertPdfSafeLiteral('Net sold to customer'),
  even: assertPdfSafeLiteral('Even (bought = sold)'),
  to: assertPdfSafeLiteral('to'),
  upTo: assertPdfSafeLiteral('Up to'),
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

/**
 * What a balance MEANS, in words a customer can act on. Uses the same side rule as every printed balance
 * (splitBalance), so a figure that rounds to nothing at the chosen decimals is "settled", never "Cr 0.00".
 */
export function balanceMeaning(net: Paisa, decimals: AmountDecimals): string {
  const { side } = splitBalance(net, decimals)
  return side === 'Dr' ? W.receivable : side === 'Cr' ? W.payable : W.settled
}

/**
 * How a rate is quoted for this currency, spelled out: "PKR 79 per AED" for a currency worth more than a
 * rupee (the rate is MULTIPLIED), "788 TMN per PKR" for the Toman (the rate is DIVIDED). The stored rate is
 * shown exactly as the dealer typed it — this only says what the number means; it converts nothing.
 */
export function rateInWords(code: string, rate: number): string {
  const meta = currencyMeta(code)
  const r = formatRate(rate, meta.rateDecimals)
  return meta.quote === 'divide' ? `${r} ${code} ${W.per} PKR` : `PKR ${r} ${W.per} ${code}`
}

// --- The document ---

export interface StatementEntry {
  /** 'YYYY-MM-DD' */
  date: string
  /** '15 Sep 2026' — printed on every row, so a row can be read on its own. */
  dateLabel: string
  /** The row's first line: what happened, from the business's side ("Sold to customer: AED 20"). */
  particulars: string
  /** The second line, smaller and grey: rate, bank, cheque number. May be empty. */
  detail: string
  /** The voucher number where one exists (JV-022), else the reference the Transactions page shows. */
  voucher: string
  /** Paisa. 0 means "blank cell". */
  debit: Paisa
  credit: Paisa
  /** The running balance AFTER this entry: positive Dr, negative Cr. */
  balance: Paisa
}

export interface StatementPendingCheque {
  direction: 'in' | 'out'
  directionLabel: string
  number: string
  bank: string
  dueLabel: string
  /** The cheque's real status — "Deposited" is never shown as cleared. */
  status: string
  amount: Paisa
}

/** One currency's trading with this customer in the period. Quantities are never added across currencies. */
export interface StatementCurrencyLine {
  code: string
  /** "UAE Dirham"; empty for a code the app has no name for. */
  name: string
  bought: number
  sold: number
  boughtLabel: string
  soldLabel: string
  /** PKR value of those deals at each deal's own rate, paisa. Not profit, not today's value. */
  boughtValue: Paisa
  soldValue: Paisa
  /** Bought less sold, in units: positive = net bought from the customer. */
  net: number
  /** The whole net on one line: "AED 25 net sold" — always labelled as a net, never as a sale of 25. */
  netLabel: string
  /** The same, as the two lines the PDF prints: "AED 25" over "Net sold to customer". Quantity is '' when even. */
  netQuantity: string
  netDirection: string
}

export interface StatementDocument {
  business: { name: string; addressLines: string[]; phone: string }
  title: string
  customerName: string
  /** The short account id: the same 8-character form the Transactions page uses for references. */
  accountId: string
  accountCurrency: { code: string; name: string }
  periodFrom: string
  periodTo: string
  /** "15 Sep 2026 to 21 Sep 2026", or "Up to 21 Sep 2026" when there is no start. */
  periodLabel: string
  generatedAt: string
  decimals: AmountDecimals

  /** Signed net, paisa: positive Dr, negative Cr. */
  opening: Paisa
  totalDebits: Paisa
  totalCredits: Paisa
  closing: Paisa
  /** "Amount payable to customer" etc. — what the closing balance means. */
  closingMeaning: string

  entries: StatementEntry[]
  entryCount: number

  pendingCheques: StatementPendingCheque[]
  pendingIn: Paisa
  pendingOut: Paisa

  currencySummary: StatementCurrencyLine[]

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
  business?: { name: string; addressLines?: readonly string[]; phone?: string }
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

  const money = (p: Paisa) => formatPaisa(p, decimals)

  // --- describe one ledger row: words + voucher, from stored fields only ---
  function describe(row: LedgerRow, amountOnRow: Paisa): { particulars: string; detail: string; voucher: string } {
    switch (row.type) {
      case 'sale':
      case 'purchase': {
        const code = pdfText(row.currency ?? 'AED', 'Currency code', warnings)
        const meta = currencyMeta(row.currency)
        const units = formatUnits(row.amount ?? 0, meta.amountDecimals)
        const verb = row.type === 'sale' ? W.soldToCustomer : W.boughtFromCustomer
        const parts: string[] = []
        if (meta.name && meta.name !== meta.code) parts.push(meta.name)
        parts.push(`${W.rate}: ${rateInWords(code, row.rate ?? 0)}`)
        // A deal part-settled at the counter moves the balance by less than its value. Say so, so the
        // figure in the Debit/Credit column is not mistaken for the deal's value.
        const act = activityById.get(row.id)
        const dealValue = rupeesToPaisa(row.pkrValue)
        if (act && !act.chequeHeld && (act.paidNow || 0) > 0 && dealValue !== amountOnRow) {
          parts.push(`${W.dealValue} PKR ${money(dealValue)}, PKR ${money(rupeesToPaisa(act.paidNow || 0))} ${W.settledAtTime}`)
        }
        return { particulars: `${verb}: ${code}${W.nbsp}${units}`, detail: parts.join(W.sep), voucher: shortRef(row.id) }
      }
      case 'receive':
      case 'pay': {
        const act = activityById.get(row.id)
        const method = act?.method
        const inward = row.type === 'receive'
        const particulars =
          method === 'Cash' ? (inward ? W.cashReceived : W.cashPaid)
          : method === 'Bank' ? (inward ? W.bankReceived : W.bankPaid)
          : method === 'Cheque' ? (inward ? W.chequeReceived : W.chequePaid)
          : inward ? W.otherReceived : W.otherPaid
        let detail = ''
        if (method === 'Bank' && act?.settlementAccountId) {
          const acct = accountById.get(act.settlementAccountId)
          if (acct?.name) detail = `${W.via} ${pdfText(acct.name, 'Bank account name', warnings)}`
        }
        return { particulars, detail, voucher: shortRef(row.id) }
      }
      case 'cheque': {
        const q = chequeById.get(row.id)
        const number = pdfText(q?.number ?? '', `Cheque number (${shortRef(row.id)})`, warnings)
        const bank = pdfText(q?.bank ?? '', `Cheque bank (cheque ${number || shortRef(row.id)})`, warnings)
        const detail = [number ? `${W.chequeNo} ${number}` : '', bank].filter(Boolean).join(W.sep)
        const particulars = q?.direction === 'Outward' ? W.chequeOutCleared : W.chequeInCleared
        return { particulars, detail, voucher: shortRef(row.id) }
      }
      default: {
        // 'journal': a manual entry or a customer-to-customer transfer.
        const e = entryById.get(row.id)
        if (!e) return { particulars: W.journal, detail: '', voucher: shortRef(row.id) }
        const ref = pdfText(e.ref, 'Journal reference', warnings)
        const debitAcct = accountById.get(e.debitAccount)
        const creditAcct = accountById.get(e.creditAccount)
        if (debitAcct?.type === 'Customer' && creditAcct?.type === 'Customer') {
          // The transfer screen debits the sender and credits the receiver, so this customer being the
          // debited leg means the balance went TO the other one, and the credited leg means it came FROM them.
          // The other customer is named exactly as the entry recorded them — nothing is inferred.
          const thisIsDebit = e.debitAccount === cust.id
          const other = pdfText(thisIsDebit ? e.creditLabel : e.debitLabel, `Customer name on transfer ${ref}`, warnings)
          return { particulars: `${thisIsDebit ? W.transferTo : W.transferFrom} ${other}`, detail: '', voucher: ref }
        }
        // A manual entry says what the person who wrote it said. It is NOT relabelled ("Service charge",
        // "Discount") — the record does not say which it is, only its narration does.
        const narration = pdfText(e.narration, `Entry narration ${ref}`, warnings)
        return { particulars: narration || W.journal, detail: '', voucher: ref }
      }
    }
  }

  // --- rows, in integer paisa ---
  const opening: Paisa = rupeesToPaisa(ledger.opening.receivable) - rupeesToPaisa(ledger.opening.payable)
  let running = opening
  let totalDebits: Paisa = 0
  let totalCredits: Paisa = 0
  const entries: StatementEntry[] = []

  for (const row of ledger.rows) {
    // The NET effect of the row. Receivable and payable are converted separately and subtracted in
    // paisa, so an allocation that moves both columns (an over-covering cheque, a crossing entry) is
    // exact rather than a difference of two floats.
    const delta: Paisa = rupeesToPaisa(row.receivableDelta) - rupeesToPaisa(row.payableDelta)

    // A payment taken by cheque that has not cleared moves nothing: it appears on the statement on the
    // day it clears. Printing it here with two empty amount cells would be a row that does nothing, so it
    // is left to the "Uncleared cheques" section, which is where a reader looks for it.
    if (delta === 0 && (row.type === 'receive' || row.type === 'pay') && activityById.get(row.id)?.chequeHeld) continue

    running += delta
    const debit = delta > 0 ? delta : 0
    const credit = delta < 0 ? -delta : 0
    totalDebits += debit
    totalCredits += credit

    const { particulars, detail, voucher } = describe(row, Math.abs(delta))
    entries.push({ date: row.date, dateLabel: pdfDate(row.date), particulars, detail, voucher, debit, credit, balance: running })
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

  // --- uncleared cheques, as at now. They do not touch the balance until they clear: customerLedger
  // counts only Cleared cheques, and a payment whose cheque is held moves nothing (see above). ---
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

  // --- currency trading summary: GROSS bought and sold per currency, from the very same period rows as
  // the table above, and the net between them. A net figure is labelled as a net — "25 AED net sold" —
  // never as though it were a sale of 25. ---
  const byCode = new Map<string, { bought: number; sold: number; boughtValue: Paisa; soldValue: Paisa }>()
  for (const row of ledger.rows) {
    if (!row.currency || (row.type !== 'sale' && row.type !== 'purchase')) continue
    const c = byCode.get(row.currency) ?? { bought: 0, sold: 0, boughtValue: 0, soldValue: 0 }
    if (row.type === 'purchase') {
      c.bought += row.amount || 0
      c.boughtValue += rupeesToPaisa(row.pkrValue)
    } else {
      c.sold += row.amount || 0
      c.soldValue += rupeesToPaisa(row.pkrValue)
    }
    byCode.set(row.currency, c)
  }
  const currencySummary: StatementCurrencyLine[] = [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rawCode, c]) => {
      const meta = currencyMeta(rawCode)
      const code = pdfText(rawCode, 'Currency code', warnings)
      const fmtU = (u: number) => `${code} ${formatUnits(u, meta.amountDecimals)}`
      const net = c.bought - c.sold
      const netRounded = Number(Math.abs(net).toFixed(meta.amountDecimals))
      return {
        code,
        name: meta.name && meta.name !== meta.code ? meta.name : '',
        bought: c.bought,
        sold: c.sold,
        boughtLabel: fmtU(c.bought),
        soldLabel: fmtU(c.sold),
        boughtValue: c.boughtValue,
        soldValue: c.soldValue,
        net,
        netLabel: netRounded === 0 ? W.even : `${fmtU(net)} ${net > 0 ? W.netBought : W.netSold}`,
        netQuantity: netRounded === 0 ? '' : fmtU(net),
        netDirection: netRounded === 0 ? W.even : net > 0 ? W.netBoughtFrom : W.netSoldTo,
      }
    })

  // --- period: the requested bounds, else what the statement actually covers ---
  const firstDate = ledger.rows[0]?.date
  const periodFrom = from ? pdfDate(from) : firstDate ? pdfDate(firstDate) : ''
  const periodTo = to ? pdfDate(to) : pdfDate(localISO(now))
  const periodLabel = periodFrom ? `${periodFrom} ${W.to} ${periodTo}` : `${W.upTo} ${periodTo}`

  const business = opts.business ?? STATEMENT_CONFIG.business
  return {
    business: {
      name: pdfText(business.name, 'Business name', warnings),
      addressLines: (business.addressLines ?? []).map((l) => pdfText(l, 'Business address', warnings)).filter(Boolean),
      phone: pdfText(business.phone ?? '', 'Business phone', warnings),
    },
    title: STATEMENT_CONFIG.title,
    customerName: pdfText(cust.name, 'Customer name', warnings),
    accountId: shortRef(cust.id),
    accountCurrency: { ...STATEMENT_CONFIG.accountCurrency },
    periodFrom,
    periodTo,
    periodLabel,
    generatedAt: `${pdfDate(localISO(now))}, ${two(now.getHours())}:${two(now.getMinutes())}`,
    decimals,
    opening,
    totalDebits,
    totalCredits,
    closing,
    closingMeaning: balanceMeaning(closing, decimals),
    entries,
    entryCount: entries.length,
    pendingCheques,
    pendingIn,
    pendingOut,
    currencySummary,
    warnings,
  }
}

export const OPENING_LABEL = W.opening
export const NO_ENTRIES_LABEL = W.noEntries
