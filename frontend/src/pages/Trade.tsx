import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { buyCalc, sellCalc, stk, CURRENCY_LIST, DEFAULT_CURRENCY, currencyMeta, currencyName } from '@/lib/engine'
import { fmt, fmtAmount, fmtLongDate, fmtQuote, fmtRate, todayISO } from '@/lib/format'
import type { SettlementMethod } from '@/lib/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'

// ---------------------------------------------------------------------------
// SETTLEMENT UI — TEMPORARILY HIDDEN, NOT REMOVED
// ---------------------------------------------------------------------------
// WHY: the client asked (Aug 2026 currency-expansion round) for the buy/sell screens to be a
// pure dealing slip — which currency, how much, at what rate, from whom, on what date — with no
// settlement decision taken at the counter. Every deal is therefore booked on CREDIT, and the
// money side is settled afterwards on the Receive / Make Payment screens, which are unchanged.
//
// The client explicitly asked for this to be REVIVABLE, so nothing here was deleted: the
// Settlement method buttons, the bank-account picker, the cheque no./bank sub-form and the
// "Amount paid/received now" input are all commented out in place below, together with the
// state and constants only they used.
//
// The BACKEND still supports all four methods (Cash / Bank / Cheque / Credit) exactly as before
// — POST /api/trades/purchase|sale is untouched by this. Restoring is a frontend-only change.
//
// TO RESTORE, un-comment, in this order:
//   1. `const METHODS` just below this block.
//   2. The `method` / `paidNow` / `bankId` / `chqNo` / `chqBank` useState lines in Trade().
//   3. The `banks` derived list in Trade().
//   4. The Credit-with-paidNow guard inside goReview().
//   5. The four commented JSX blocks in the `form` step, each tagged
//      `RESTORE SETTLEMENT (n/4)`.
//   6. The `Settlement` Row in the review step, tagged `RESTORE SETTLEMENT`.
//   7. In confirm(), swap the fixed `method: CREDIT_ONLY, paidNow: 0, bankId: '', chqNo: '',
//      chqBank: ''` payload fields back to the state variables.
//   8. Re-add the one import those blocks need, dropped so oxlint stays clean while they are
//      commented out: `import { cn } from '@/lib/utils'`.
//   9. In the `calc` useMemo, swap the fixed `CREDIT_ONLY, 0` arguments back to
//      `method, parseFloat(paidNow) || 0` and add `method`/`paidNow` to its dependency array.
//      The trailing `currency` argument stays either way — it is what tells buyCalc/sellCalc
//      how to read the rate, and is unrelated to settlement.
// ---------------------------------------------------------------------------
// const METHODS: SettlementMethod[] = ['Cash', 'Bank', 'Cheque', 'Credit']

/** Every trade posts on credit while the settlement UI above is hidden. */
const CREDIT_ONLY: SettlementMethod = 'Credit'

export function Trade({ mode }: { mode: 'buy' | 'sell' }) {
  const { state, confirmPurchase, confirmSale, getAccount } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const presetCustomerId = (location.state as { customerId?: string } | null)?.customerId || ''

  const [step, setStep] = useState<'form' | 'review' | 'done'>('form')
  const [customerId, setCustomerId] = useState(presetCustomerId)
  const [custSearch, setCustSearch] = useState('')
  // DEFAULT_CURRENCY, not CURRENCY_LIST[0]: the picker is ordered strongest-to-weakest against
  // PKR, so adding EUR and USD moved AED off the top of that list. Taking the first entry would
  // have silently changed the default the screen opens on to a currency the desk holds no stock in.
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [txnDate, setTxnDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  // RESTORE SETTLEMENT — state used only by the hidden settlement UI:
  // const [method, setMethod] = useState<SettlementMethod>('Credit')
  // const [paidNow, setPaidNow] = useState('')
  // const [bankId, setBankId] = useState(state.accounts.find((a) => a.type === 'Bank')?.id || 'bank')
  // const [chqNo, setChqNo] = useState('')
  // const [chqBank, setChqBank] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<{ currency: string; txnDate: string; amount: number; rate: number; value: number; outstanding: number } | null>(null)

  const customers = state.accounts.filter((a) => a.type === 'Customer')
  const filteredCustomers = customSearchFilter(customers, custSearch)
  const cust = getAccount(customerId)
  // RESTORE SETTLEMENT — const banks = state.accounts.filter((a) => a.type === 'Bank')
  const meta = currencyMeta(currency)
  const avail = stk(state.stocks, currency).available
  const avgCost = stk(state.stocks, currency).avgCost

  // `rate` is in the selected currency's own quote convention, so `currency` has to reach the
  // calculators — they are the only place the multiply-vs-divide decision is made. Never do this
  // arithmetic inline here.
  const calc = useMemo(() => {
    const amt = parseFloat(amount) || 0
    const r = parseFloat(rate) || 0
    if (mode === 'buy') return buyCalc(amt, r, CREDIT_ONLY, 0, currency)
    return sellCalc(amt, r, avgCost, CREDIT_ONLY, 0, currency)
  }, [amount, rate, mode, avgCost, currency])

  const value = mode === 'buy' ? (calc as ReturnType<typeof buyCalc>).pkrValue : (calc as ReturnType<typeof sellCalc>).saleValue

  function goReview() {
    if (!customerId) return setError(mode === 'buy' ? 'Select a supplying customer.' : 'Select a customer.')
    const amt = parseFloat(amount) || 0
    const r = parseFloat(rate) || 0
    if (amt <= 0 || r <= 0) return setError('Enter a valid amount and rate greater than 0.')
    if (!txnDate) return setError('Enter the date this deal was struck.')
    if (txnDate > todayISO()) return setError('The transaction date cannot be in the future — a deal can only be recorded on or after the day it was struck.')
    if (mode === 'sell' && amt > avail) return setError(`Cannot sell more than available ${currency} stock (${fmtAmount(avail, currency)} ${currency}).`)
    // RESTORE SETTLEMENT — Credit-method guard, meaningless while every deal is Credit:
    // if (method === 'Credit' && (parseFloat(paidNow) || 0) > 0) {
    //   return setError(`A credit ${mode === 'buy' ? 'purchase' : 'sale'} cannot carry an amount ${mode === 'buy' ? 'paid' : 'received'} now — there is no settlement account to debit.`)
    // }
    setError('')
    setStep('review')
  }

  async function confirm() {
    const amt = parseFloat(amount) || 0
    const r = parseFloat(rate) || 0
    // RESTORE SETTLEMENT — swap the five fixed fields below back to
    // `method, paidNow: parseFloat(paidNow) || 0, bankId, chqNo, chqBank`.
    // A blank bankId is what a Credit deal has always sent; the server resolves its own default
    // bank account when a settlement account is actually needed.
    const input = { customerId, currency, txnDate, amount: amt, rate: r, method: CREDIT_ONLY, paidNow: 0, bankId: '', chqNo: '', chqBank: '' }
    setSubmitting(true)
    const res = mode === 'buy' ? await confirmPurchase(input) : await confirmSale(input)
    setSubmitting(false)
    if (!res.ok) return setError(res.error || 'Could not post this transaction.')
    // Only reached once the server has confirmed — nothing here is shown before that.
    setLastResult({
      currency,
      txnDate,
      amount: amt,
      rate: r,
      value,
      outstanding: mode === 'buy' ? (calc as ReturnType<typeof buyCalc>).outstanding : (calc as ReturnType<typeof sellCalc>).outstanding,
    })
    setStep('done')
  }

  const title = mode === 'buy' ? 'Buy Currency' : 'Sell Currency'
  const counterpartyLabel = mode === 'buy' ? 'Supplier' : 'Customer'

  return (
    <div className="max-w-[560px]">
      <div className="mb-3">
        <BackButton label="Currency Stock" onBack={() => navigate('/stock')} />
      </div>
      {/* No explanatory subtitle. "Business receives currency, business owes the supplying
          customer" was the screen narrating its own bookkeeping to a dealer who already knows
          which direction a purchase runs. The margin below is what the subtitle used to occupy. */}
      <h1 className="m-0 mb-[26px] text-heading font-semibold">{title}</h1>

      {step === 'form' && (
        <Card className="animate-step flex flex-col gap-3 p-4">
          <div>
            <label className="mb-1 block text-meta font-semibold text-muted-70">{mode === 'buy' ? 'Customer / Supplier' : 'Customer'}</label>
            <Input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Type to filter customers…" className="mb-1.5 h-[30px] text-body" />
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-[34px] w-full rounded-control border border-border-input bg-surface px-2.5 text-body transition-colors duration-150">
              <option value="">Select customer…</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Currency</label>
              {/* Code only as the visible label, with the full name on hover via `title` — on the
                  select for whatever is currently chosen, and on each option in the open list. A
                  dealer reads the code; the name is there for the rare moment someone needs it,
                  rather than occupying the control permanently. */}
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                title={currencyName(currency)}
                className="h-[34px] w-full rounded-control border border-border-input bg-surface px-2 text-body font-medium transition-colors duration-150"
              >
                {CURRENCY_LIST.map((c) => (
                  <option key={c.code} value={c.code} title={c.name}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Transaction date</label>
              <DatePicker value={txnDate} onChange={setTxnDate} placeholder="Deal date" className="h-[34px] w-full justify-start border-border-input text-body" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Amount to {mode === 'buy' ? 'buy' : 'sell'}</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="0" className="tabular h-[34px] text-body" />
              <div className="mt-0.5 text-meta font-normal text-muted-60">{mode === 'sell' ? `Available ${fmtAmount(avail, currency)} ${currency}` : `In ${currency}`}</div>
            </div>
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">{mode === 'buy' ? 'Purchase rate' : 'Selling rate'}</label>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" placeholder="0.00" className="tabular h-[34px] text-body" />
              {/* The label spells out which convention this box expects — it flips per currency
                  (PKR per 1 AED, but IRR per 1 PKR), so the dealer never has to guess. */}
              <div className="mt-0.5 text-meta font-semibold text-muted-70">{meta.rateLabel}</div>
              <div className="text-meta font-normal text-muted-60">Avg cost {fmtQuote(currency, avgCost)}</div>
            </div>
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">PKR value</label>
              <div className="tabular flex h-[34px] items-center rounded-control border border-border bg-app px-2.5 text-body font-medium">{fmt(value)}</div>
            </div>
          </div>

          {/* RESTORE SETTLEMENT (1/4) — method buttons
          <div>
            <label className="mb-1.5 block text-meta font-semibold text-muted-70">Settlement</label>
            <div className="inline-flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(method === m && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
                >
                  {m}
                </Button>
              ))}
            </div>
          </div>
          */}

          {/* RESTORE SETTLEMENT (2/4) — bank-account picker
          {(method === 'Bank' || method === 'Cheque') && (
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Bank account</label>
              <div className="flex flex-wrap gap-1.5">
                {banks.map((b) => (
                  <Button
                    key={b.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-pressed={bankId === b.id}
                    onClick={() => setBankId(b.id)}
                    className={cn('text-meta', bankId === b.id && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
                  >
                    {b.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          */}

          {/* RESTORE SETTLEMENT (3/4) — cheque no. / bank sub-form
          {method === 'Cheque' && (
            <div className="rounded-control border border-border bg-surface-sunken p-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-meta font-semibold text-muted-70">Cheque no.</label>
                  <Input value={chqNo} onChange={(e) => setChqNo(e.target.value)} placeholder="Auto" className="tabular h-8 text-body" />
                </div>
                <div>
                  <label className="mb-1 block text-meta font-semibold text-muted-70">Bank</label>
                  <Input value={chqBank} onChange={(e) => setChqBank(e.target.value)} placeholder="Meezan, HBL…" className="h-8 text-body" />
                </div>
              </div>
              <div className="mt-2 text-meta font-normal leading-[1.45] text-muted-60">
                Recorded as a pending {mode === 'buy' ? 'outward' : 'inward'} cheque. The {mode === 'buy' ? 'payable' : 'receivable'} stays outstanding until the cheque clears.
              </div>
            </div>
          )}
          */}

          {/* RESTORE SETTLEMENT (4/4) — amount paid/received now
          {(method === 'Cash' || method === 'Bank' || method === 'Cheque') && (
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Amount {mode === 'buy' ? 'paid' : 'received'} now (PKR)</label>
              <Input value={paidNow} onChange={(e) => setPaidNow(e.target.value)} type="number" className="tabular h-[34px] text-body" />
            </div>
          )}
          */}

          {calc.outstanding > 0 && (
            <div className={`rounded-control px-2.5 py-2 text-body font-normal ${mode === 'buy' ? 'bg-negative-bg text-negative-deep' : 'bg-positive-bg text-positive-text'}`}>
              Creates a <b className="font-semibold">{mode === 'buy' ? 'Payable' : 'Receivable'} of {fmt(calc.outstanding)}</b> {mode === 'buy' ? 'to' : 'from'} {cust?.name || 'this customer'}. Settle it later
              on the {mode === 'buy' ? 'Make Payment' : 'Receive Payment'} screen.
            </div>
          )}
          {error && <div className="text-body font-semibold text-negative">{error}</div>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={goReview}>
              Review {mode === 'buy' ? 'Purchase' : 'Sale'}
            </Button>
          </div>
        </Card>
      )}

      {step === 'review' && (
        <Card variant="flat" className="animate-step p-4">
          <div className="mb-2.5 text-meta font-semibold uppercase tracking-wide text-muted-60">Review {mode === 'buy' ? 'purchase' : 'sale'}</div>
          {/* Reads top-to-bottom like a dealing slip: what was traded, at what rate, with whom,
              on what date, for how much — in that order, in plain words. */}
          <div className="flex flex-col gap-1.5 text-body">
            <Row label="Currency" value={`${currencyName(currency)} (${currency})`} bold />
            <Row label={mode === 'buy' ? 'Quantity bought' : 'Quantity sold'} value={`${fmtAmount(parseFloat(amount) || 0, currency)} ${currency}`} mono />
            <Row label={mode === 'buy' ? 'Purchase rate' : 'Selling rate'} value={`${fmtRate(parseFloat(rate) || 0, currency)} · ${meta.rateLabel}`} mono />
            <Row label={counterpartyLabel} value={cust?.name || ''} bold />
            <Row label="Transaction date" value={fmtLongDate(txnDate)} mono />
            {/* RESTORE SETTLEMENT — <Row label="Settlement" value={method} bold /> */}
            <div className="flex justify-between border-t border-divider pt-2">
              <span className="font-normal text-muted-70">{mode === 'buy' ? 'PKR value' : 'Sale value'}</span>
              <b className="tabular text-body font-semibold">{fmt(value)}</b>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1.5 rounded-control border border-border bg-surface-sunken p-2.5">
            <div className="text-meta font-semibold uppercase tracking-wide text-muted-60">What will happen</div>
            <Bullet color="var(--color-accent)">
              {mode === 'buy'
                ? `${currencyName(currency)} stock increases by ${fmtAmount(parseFloat(amount) || 0, currency)} ${currency}.`
                : `${currencyName(currency)} stock decreases by ${fmtAmount(parseFloat(amount) || 0, currency)} ${currency}.`}
            </Bullet>
            <Bullet color="var(--color-accent)">
              {mode === 'buy' ? 'The weighted-average cost of this currency recalculates.' : 'The sale is drawn down at the weighted-average cost held in stock.'}
            </Bullet>
            <Bullet color={calc.outstanding > 0 ? 'var(--color-pending)' : 'var(--color-positive)'}>
              {calc.outstanding > 0 ? `${fmt(calc.outstanding)} stays outstanding as a ${mode === 'buy' ? 'payable' : 'receivable'}.` : 'Fully settled — nothing stays outstanding.'}
            </Bullet>
            <Bullet color="var(--color-accent)">The deal is dated {fmtLongDate(txnDate)}, so it lands in that day's reporting period.</Bullet>
          </div>
          {error && <div className="mt-3 text-body font-semibold text-negative">{error}</div>}
          <div className="mt-3.5 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => setStep('form')}>
              Back
            </Button>
            <Button type="button" variant="primary" disabled={submitting} onClick={confirm}>
              {submitting ? 'Posting…' : `Confirm ${mode === 'buy' ? 'Purchase' : 'Sale'}`}
            </Button>
          </div>
        </Card>
      )}

      {step === 'done' && lastResult && (
        <Card variant="flat" className={`animate-step border-l-[3px] p-4 ${mode === 'buy' ? 'border-l-accent' : 'border-l-positive'}`}>
          <div className={`mb-2.5 text-meta font-semibold uppercase tracking-wide ${mode === 'buy' ? 'text-accent' : 'text-positive'}`}>{mode === 'buy' ? 'Purchase posted' : 'Sale posted'}</div>
          <div className="mb-3 text-body font-normal leading-[1.6]">
            {mode === 'buy' ? 'Bought' : 'Sold'}{' '}
            <b className="font-semibold">
              {fmtAmount(lastResult.amount, lastResult.currency)} {lastResult.currency}
            </b>{' '}
            ({currencyName(lastResult.currency)}) {mode === 'buy' ? 'from' : 'to'} <b className="font-semibold">{cust?.name}</b> on <b className="font-semibold">{fmtLongDate(lastResult.txnDate)}</b>.
          </div>
          <div className="flex flex-col gap-1.5 rounded-control border border-border bg-surface-sunken p-2.5 text-body">
            <Row label={mode === 'buy' ? 'Purchase rate' : 'Selling rate'} value={`${fmtRate(lastResult.rate, lastResult.currency)} · ${currencyMeta(lastResult.currency).rateLabel}`} mono />
            <Row label={mode === 'buy' ? 'PKR value' : 'Sale value'} value={fmt(lastResult.value)} mono bold />
            {lastResult.outstanding > 0 && <Row label={mode === 'buy' ? 'Payable created' : 'Receivable created'} value={fmt(lastResult.outstanding)} mono bold />}
          </div>
          <div className="mt-3.5 flex gap-2">
            <Button type="button" variant="primary" onClick={() => navigate(`/customers/${customerId}`)}>
              View Customer
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/dashboard')}>
              Back to Overview
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function customSearchFilter(customers: { id: string; name: string }[], q: string) {
  const s = q.trim().toLowerCase()
  return s ? customers.filter((c) => c.name.toLowerCase().includes(s)) : customers
}

function Row({ label, value, bold, mono, positive }: { label: string; value: string; bold?: boolean; mono?: boolean; positive?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="flex-none font-normal text-muted-70">{label}</span>
      <span className={`text-right ${bold ? 'font-semibold' : 'font-normal'} ${mono ? 'tabular' : ''} ${positive ? 'text-positive' : ''}`}>{value}</span>
    </div>
  )
}

function Bullet({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-[5px] h-[5px] w-[5px] flex-none rounded-full" style={{ background: color }} aria-hidden="true" />
      <div className="text-body font-normal leading-[1.45]">{children}</div>
    </div>
  )
}
