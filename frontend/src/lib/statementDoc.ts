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
// everything after is integer arithmetic, so the columns add up on paper. Totals are summed from those
// integers, never from formatted text.
//
// THE SIGN CONVENTION, traced rather than assumed: `customerLedger`'s runningNet is receivable − payable,
// so a POSITIVE net is Dr — the customer owes the business — and a NEGATIVE net is Cr — the business owes
// the customer. A sale to the customer is a debit (it adds to what they owe); a purchase from them, and
// money received from them, are credits.
//
// THE PERSPECTIVE IS THE CUSTOMER'S, always — the document is addressed to them, whoever generates it (an
// admin and an operator get identical words). "You owe" / "We owe you" / "Account settled" for the balance;
// "You bought" when the desk SOLD to them and "You sold" when the desk BOUGHT from them. Nothing here reads
// the viewer's role. A manual journal entry keeps the narration its author wrote: the record does not say
// whether a credit is a discount or a debit is a service charge, so the words are never guessed.

// --- The words WE write. Checked at load: a character the PDF font cannot print throws right here. ---
const W = {
  youBought: assertPdfSafeLiteral('You bought'),
  youSold: assertPdfSafeLiteral('You sold'),
  sep: assertPdfSafeLiteral(' · '), // middle dot: in Latin-1, so the font has it
  /** No-break space: keeps a currency code on the same line as its amount when a description wraps. */
  nbsp: assertPdfSafeLiteral(' '),
  paymentReceived: assertPdfSafeLiteral('Payment received'),
  paymentSent: assertPdfSafeLiteral('Payment sent to you'),
  chequeReceived: assertPdfSafeLiteral('Cheque received — cleared'),
  chequeSent: assertPdfSafeLiteral('Cheque sent to you — cleared'),
  chequeNo: assertPdfSafeLiteral('Cheque no.'),
  transferTo: assertPdfSafeLiteral('Transfer to'),
  transferFrom: assertPdfSafeLiteral('Transfer from'),
  journal: assertPdfSafeLiteral('Journal entry'),
  dealValue: assertPdfSafeLiteral('Deal value'),
  paidAtTime: assertPdfSafeLiteral('paid at the time'),
  cash: assertPdfSafeLiteral('Cash'),
  bankTransfer: assertPdfSafeLiteral('Bank transfer'),
  chequeMethod: assertPdfSafeLiteral('Cheque'),
  enDash: assertPdfSafeLiteral('\u2013'),
  opening: assertPdfSafeLiteral('Opening balance'),
  noEntries: assertPdfSafeLiteral('No transactions in this period.'),
  youOwe: assertPdfSafeLiteral('You owe'),
  weOweYou: assertPdfSafeLiteral('We owe you'),
  settled: assertPdfSafeLiteral('Account settled'),
  youOwed: assertPdfSafeLiteral('you owed'),
  weOwedYou: assertPdfSafeLiteral('we owed you'),
  fromYou: assertPdfSafeLiteral('From you'),
  toYou: assertPdfSafeLiteral('To you'),
  netBought: assertPdfSafeLiteral('Net bought from you'),
  netSold: assertPdfSafeLiteral('Net sold to you'),
  even: assertPdfSafeLiteral('Even'),
  to: assertPdfSafeLiteral('to'),
  upTo: assertPdfSafeLiteral('Up to'),
} as const

export const STATEMENT_WORDS = W
export const OPENING_LABEL = W.opening
export const NO_ENTRIES_LABEL = W.noEntries

/**
 * Codes whose meaning a customer cannot be expected to know — Toman has no ISO code, so "TMN" alone is
 * opaque. Their name is shown in the optional currency trading summary; the ledger rows follow the approved
 * design and show the code with its rate equation ("788 TMN = 1 PKR"), which already says what it is.
 */
const NAME_HELPS = new Set(['TMN'])

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-19' -> '19 Sep 2026'. Unambiguous whichever side of the world reads it. */
export function pdfDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? '?'} ${y}`
}

/** '2026-09-19' -> '19 Sep' — for rows of a statement that sits inside one calendar year. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? '?'}`
}

/**
 * A period as a heading, saying each part once: "19\u201325 September 2026", "28 August \u2013 3 September 2026",
 * "28 December 2025 \u2013 3 January 2026", or "19 September 2026" for a single day.
 */
export function rangeTitle(fromIso: string, toIso: string): string {
  const [fy, fm, fd] = fromIso.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = toIso.slice(0, 10).split('-').map(Number)
  const month = (m: number) => LONG_MONTHS[m - 1] ?? '?'
  if (fy === ty && fm === tm && fd === td) return `${td} ${month(tm)} ${ty}`
  if (fy === ty && fm === tm) return `${fd}${W.enDash}${td} ${month(tm)} ${ty}`
  if (fy === ty) return `${fd} ${month(fm)} ${W.enDash} ${td} ${month(tm)} ${ty}`
  return `${fd} ${month(fm)} ${fy} ${W.enDash} ${td} ${month(tm)} ${ty}`
}

const two = (n: number) => String(n).padStart(2, '0')
const localISO = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`

/**
 * What a closing balance MEANS to the customer: "You owe" (Dr), "We owe you" (Cr), "Account settled" (nothing —
 * including a figure that rounds to nothing at the chosen decimals, so never "We owe you 0.00").
 */
export function balanceLabel(net: Paisa, decimals: AmountDecimals): string {
  const { side } = splitBalance(net, decimals)
  return side === 'Dr' ? W.youOwe : side === 'Cr' ? W.weOweYou : W.settled
}

/** The same fact in the past tense, for the opening balance: "you owed", "we owed you", or '' when nothing was owed. */
export function openingNote(net: Paisa, decimals: AmountDecimals): string {
  const { side } = splitBalance(net, decimals)
  return side === 'Dr' ? W.youOwed : side === 'Cr' ? W.weOwedYou : ''
}

/**
 * How a rate is quoted, spelled out as an equation the customer can read: "1 AED = 79 PKR" for a currency worth
 * more than a rupee (the rate is MULTIPLIED), "788 TMN = 1 PKR" for the Toman (the rate is DIVIDED).
 * The stored rate is shown as the dealer typed it — this only says what the number means; it converts and rounds
 * nothing beyond the currency's own display precision.
 */
export function rateInWords(code: string, rate: number): string {
  const meta = currencyMeta(code)
  const r = formatRate(rate, meta.rateDecimals)
  return meta.quote === 'divide' ? `${r} ${code} = 1 PKR` : `1 ${code} = ${r} PKR`
}

// --- The document ---

export interface StatementEntry {
  /** 'YYYY-MM-DD' */
  date: string
  /** '15 Sep 2026' — printed on every row, so a row can be read on its own. */
  dateLabel: string
  /** The row's first line, from the customer's side ("You bought TMN 3,000,000,000"). */
  particulars: string
  /** The second line, smaller and grey: rate, bank, cheque number. May be empty. */
  detail: string
  /** The voucher number where one exists (JV-022), else the reference the Transactions page shows. */
  reference: string
  /** Paisa. 0 means "blank cell". */
  debit: Paisa
  credit: Paisa
  /** The running balance AFTER this entry: positive Dr, negative Cr. */
  balance: Paisa
}

export interface StatementPendingCheque {
  direction: 'in' | 'out'
  /** "From you" or "To you". */
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
  /** "Toman" where the code alone would not be understood; empty otherwise. */
  name: string
  /** Units the desk bought FROM the customer, and sold TO them. */
  bought: number
  sold: number
  boughtLabel: string
  soldLabel: string
  /** PKR value of those deals at each deal's own rate, paisa. Not profit, not today's value. Kept for callers that want it. */
  boughtValue: Paisa
  soldValue: Paisa
  /** Bought less sold, in units: positive = net bought from the customer. */
  net: number
  /** The net on one line: "AED 25 net sold to you" — always labelled as a net, never as a sale of 25. */
  netLabel: string
  /** The net as the two lines the PDF prints: "AED 25" over "Net sold to you". Quantity is '' when even. */
  netQuantity: string
  netDirection: string
}

export interface StatementDocument {
  business: {
    name: string
    /** A short line under the name ("Currency Exchange"); '' when none is configured. */
    tagline: string
    /** Address and phone joined on one line; '' when none is configured. */
    contactLine: string
  }
  title: string
  customerName: string
  /** The short account reference: the same 8-character form the Transactions page uses. */
  accountRef: string
  accountCurrency: { code: string; name: string }
  periodFrom: string
  periodTo: string
  /** "15 Sep 2026 to 21 Sep 2026", or "Up to 21 Sep 2026" when there is no start. */
  periodLabel: string
  /** The period as a heading: "19\u201325 September 2026", "28 August \u2013 3 September 2026", "Up to 21 Sep 2026". */
  periodTitle: string
  /** Date labels for the opening and closing rows, in the same short-or-long form as the entries. '' when unknown. */
  openingDateLabel: string
  closingDateLabel: string
  /** The date the closing balance is struck at: the period end. Not necessarily today. */
  asAtLabel: string
  generatedAt: string
  decimals: AmountDecimals

  /** Signed net, paisa: positive Dr, negative Cr. */
  opening: Paisa
  /** "you owed" / "we owed you" / '' — the opening balance's direction in words. */
  openingNote: string
  totalDebits: Paisa
  totalCredits: Paisa
  closing: Paisa
  /** "You owe" / "We owe you" / "Account settled". */
  closingLabel: string

  entries: StatementEntry[]
  entryCount: number

  pendingCheques: StatementPendingCheque[]
  pendingIn: Paisa
  pendingOut: Paisa

  /** Always computed; only printed when `showCurrencySummary` is on. */
  currencySummary: StatementCurrencyLine[]
  showCurrencySummary: boolean

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
  business?: { name: string; tagline?: string; addressLines?: readonly string[]; phone?: string }
  /** Print the per-currency trading table. Off unless asked: it is noise on an ordinary account statement. */
  includeCurrencySummary?: boolean
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

  // --- describe one ledger row: words + reference, from stored fields only ---
  function describe(row: LedgerRow, amountOnRow: Paisa): { particulars: string; detail: string; reference: string } {
    switch (row.type) {
      case 'sale':
      case 'purchase': {
        const code = pdfText(row.currency ?? 'AED', 'Currency code', warnings)
        const meta = currencyMeta(row.currency)
        const units = formatUnits(row.amount ?? 0, meta.amountDecimals)
        // The desk SELLING to the customer is the customer BUYING, and the other way round.
        const verb = row.type === 'sale' ? W.youBought : W.youSold
        const parts: string[] = []
        parts.push(rateInWords(code, row.rate ?? 0))
        // A deal part-settled at the counter moves the balance by less than its value. Say so, so the figure in
        // the Debit/Credit column is not mistaken for the deal's value.
        const act = activityById.get(row.id)
        const dealValue = rupeesToPaisa(row.pkrValue)
        if (act && !act.chequeHeld && (act.paidNow || 0) > 0 && dealValue !== amountOnRow) {
          parts.push(`${W.dealValue} ${money(dealValue)}, ${money(rupeesToPaisa(act.paidNow || 0))} ${W.paidAtTime}`)
        }
        return { particulars: `${verb} ${code}${W.nbsp}${units}`, detail: parts.join(W.sep), reference: shortRef(row.id) }
      }
      case 'receive':
      case 'pay': {
        const act = activityById.get(row.id)
        const method = act?.method
        const particulars = row.type === 'receive' ? W.paymentReceived : W.paymentSent
        // How it moved goes on the second line, after the reference: "5C55E1E4 · Cash", "07400A07 · Bank transfer".
        const parts: string[] = []
        if (method === 'Cash') parts.push(W.cash)
        else if (method === 'Bank') {
          parts.push(W.bankTransfer)
          const acct = act?.settlementAccountId ? accountById.get(act.settlementAccountId) : undefined
          if (acct?.name) parts.push(pdfText(acct.name, 'Bank account name', warnings))
        } else if (method === 'Cheque') parts.push(W.chequeMethod)
        const detail = parts.join(W.sep)
        return { particulars, detail, reference: shortRef(row.id) }
      }
      case 'cheque': {
        const q = chequeById.get(row.id)
        const number = pdfText(q?.number ?? '', `Cheque number (${shortRef(row.id)})`, warnings)
        const bank = pdfText(q?.bank ?? '', `Cheque bank (cheque ${number || shortRef(row.id)})`, warnings)
        const detail = [number ? `${W.chequeNo} ${number}` : '', bank].filter(Boolean).join(W.sep)
        return { particulars: q?.direction === 'Outward' ? W.chequeSent : W.chequeReceived, detail, reference: shortRef(row.id) }
      }
      default: {
        // 'journal': a manual entry or a customer-to-customer transfer.
        const e = entryById.get(row.id)
        if (!e) return { particulars: W.journal, detail: '', reference: shortRef(row.id) }
        const ref = pdfText(e.ref, 'Journal reference', warnings)
        const debitAcct = accountById.get(e.debitAccount)
        const creditAcct = accountById.get(e.creditAccount)
        if (debitAcct?.type === 'Customer' && creditAcct?.type === 'Customer') {
          // The transfer screen debits the sender and credits the receiver, so this customer being the
          // debited leg means the balance went TO the other one, and the credited leg means it came FROM them.
          // The other customer is named exactly as the entry recorded them — nothing is inferred.
          const thisIsDebit = e.debitAccount === cust.id
          const other = pdfText(thisIsDebit ? e.creditLabel : e.debitLabel, `Customer name on transfer ${ref}`, warnings)
          return { particulars: `${thisIsDebit ? W.transferTo : W.transferFrom} ${other}`, detail: '', reference: ref }
        }
        const narration = pdfText(e.narration, `Entry narration ${ref}`, warnings)
        return { particulars: narration || W.journal, detail: '', reference: ref }
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

    const { particulars, detail, reference } = describe(row, Math.abs(delta))
    entries.push({ date: row.date, dateLabel: '', particulars, detail, reference, debit, credit, balance: running })
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
        directionLabel: q.direction === 'Inward' ? W.fromYou : W.toYou,
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
  // the table, and the net between them. A net figure is labelled as a net — "AED 25 / Net sold to you" —
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
      const fmtU = (u: number) => `${code}${W.nbsp}${formatUnits(u, meta.amountDecimals)}`
      const net = c.bought - c.sold
      const netRounded = Number(Math.abs(net).toFixed(meta.amountDecimals))
      const direction = netRounded === 0 ? W.even : net > 0 ? W.netBought : W.netSold
      return {
        code,
        name: NAME_HELPS.has(code) && meta.name && meta.name !== meta.code ? meta.name : '',
        bought: c.bought,
        sold: c.sold,
        boughtLabel: fmtU(c.bought),
        soldLabel: fmtU(c.sold),
        boughtValue: c.boughtValue,
        soldValue: c.soldValue,
        net,
        netLabel: netRounded === 0 ? W.even : `${fmtU(net)} ${direction.charAt(0).toLowerCase()}${direction.slice(1)}`,
        netQuantity: netRounded === 0 ? '' : fmtU(net),
        netDirection: direction,
      }
    })

  // --- period: the requested bounds, else what the statement actually covers ---
  const firstDate = ledger.rows[0]?.date
  const periodFrom = from ? pdfDate(from) : firstDate ? pdfDate(firstDate) : ''
  const periodTo = to ? pdfDate(to) : pdfDate(localISO(now))
  const periodLabel = periodFrom ? `${periodFrom} ${W.to} ${periodTo}` : `${W.upTo} ${periodTo}`

  // A statement inside one calendar year prints "19 Sep" on its rows, as the approved design does; one that
  // crosses a year prints the year on every row, so no row is ambiguous.
  const fromIso = from || firstDate || ''
  const toIso = to || localISO(now)
  const years = new Set([toIso.slice(0, 4), ...(fromIso ? [fromIso.slice(0, 4)] : []), ...entries.map((e) => e.date.slice(0, 4))])
  for (const e of entries) e.dateLabel = years.size === 1 ? shortDate(e.date) : pdfDate(e.date)
  const rowDate = (iso: string) => (iso ? (years.size === 1 ? shortDate(iso) : pdfDate(iso)) : '')
  const periodTitle = fromIso ? rangeTitle(fromIso, toIso) : `${W.upTo} ${periodTo}`

  const business = opts.business ?? STATEMENT_CONFIG.business
  const contact = [...(business.addressLines ?? []).map((l) => pdfText(l, 'Business address', warnings)), pdfText(business.phone ?? '', 'Business phone', warnings) && `Tel. ${pdfText(business.phone ?? '', 'Business phone', warnings)}`].filter(Boolean)
  return {
    business: {
      name: pdfText(business.name, 'Business name', warnings),
      tagline: pdfText(business.tagline ?? '', 'Business tagline', warnings),
      contactLine: contact.join(W.sep),
    },
    title: STATEMENT_CONFIG.title,
    customerName: pdfText(cust.name, 'Customer name', warnings),
    accountRef: shortRef(cust.id),
    accountCurrency: { ...STATEMENT_CONFIG.accountCurrency },
    periodFrom,
    periodTo,
    periodLabel,
    periodTitle,
    openingDateLabel: rowDate(fromIso),
    closingDateLabel: rowDate(toIso),
    asAtLabel: periodTo,
    generatedAt: `${pdfDate(localISO(now))}, ${two(now.getHours())}:${two(now.getMinutes())}`,
    decimals,
    opening,
    openingNote: openingNote(opening, decimals),
    totalDebits,
    totalCredits,
    closing,
    closingLabel: balanceLabel(closing, decimals),
    entries,
    entryCount: entries.length,
    pendingCheques,
    pendingIn,
    pendingOut,
    currencySummary,
    showCurrencySummary: opts.includeCurrencySummary === true,
    warnings,
  }
}
