import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { buyCalc, sellCalc, stk } from '@/lib/engine'
import { fmt, fmtNum, fmtRate } from '@/lib/format'
import type { SettlementMethod } from '@/lib/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { SignedAmount } from '@/components/ui/signed-amount'
import { cn } from '@/lib/utils'

const METHODS: SettlementMethod[] = ['Cash', 'Bank', 'Cheque', 'Credit']

export function Trade({ mode }: { mode: 'buy' | 'sell' }) {
  const { state, confirmPurchase, confirmSale, getAccount } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const presetCustomerId = (location.state as { customerId?: string } | null)?.customerId || ''

  const [step, setStep] = useState<'form' | 'review' | 'done'>('form')
  const [customerId, setCustomerId] = useState(presetCustomerId)
  const [custSearch, setCustSearch] = useState('')
  const [currency, setCurrency] = useState('AED')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [method, setMethod] = useState<SettlementMethod>('Credit')
  const [paidNow, setPaidNow] = useState('')
  const [bankId, setBankId] = useState(state.accounts.find((a) => a.type === 'Bank')?.id || 'bank')
  const [chqNo, setChqNo] = useState('')
  const [chqBank, setChqBank] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<{ amount: number; rate: number; value: number; margin?: number; outstanding: number } | null>(null)

  const customers = state.accounts.filter((a) => a.type === 'Customer')
  const filteredCustomers = customSearchFilter(customers, custSearch)
  const cust = getAccount(customerId)
  const banks = state.accounts.filter((a) => a.type === 'Bank')
  const avail = stk(state.stocks, currency).available
  const avgCost = stk(state.stocks, currency).avgCost

  const calc = useMemo(() => {
    const amt = parseFloat(amount) || 0
    const r = parseFloat(rate) || 0
    if (mode === 'buy') return buyCalc(amt, r, method, parseFloat(paidNow) || 0)
    return sellCalc(amt, r, avgCost, method, parseFloat(paidNow) || 0)
  }, [amount, rate, method, paidNow, mode, avgCost])

  const value = mode === 'buy' ? (calc as ReturnType<typeof buyCalc>).pkrValue : (calc as ReturnType<typeof sellCalc>).saleValue
  const margin = mode === 'sell' ? (calc as ReturnType<typeof sellCalc>).margin : undefined
  const cost = mode === 'sell' ? (calc as ReturnType<typeof sellCalc>).cost : undefined

  function goReview() {
    if (!customerId) return setError(mode === 'buy' ? 'Select a supplying customer.' : 'Select a customer.')
    const amt = parseFloat(amount) || 0
    const r = parseFloat(rate) || 0
    if (amt <= 0 || r <= 0) return setError('Enter a valid amount and rate greater than 0.')
    if (mode === 'sell' && amt > avail) return setError(`Cannot sell more than available ${currency} stock (${fmtNum(avail)} ${currency}).`)
    if (method === 'Credit' && (parseFloat(paidNow) || 0) > 0) {
      return setError(`A credit ${mode === 'buy' ? 'purchase' : 'sale'} cannot carry an amount ${mode === 'buy' ? 'paid' : 'received'} now — there is no settlement account to debit.`)
    }
    setError('')
    setStep('review')
  }

  async function confirm() {
    const amt = parseFloat(amount) || 0
    const r = parseFloat(rate) || 0
    const pNow = parseFloat(paidNow) || 0
    const input = { customerId, currency, amount: amt, rate: r, method, paidNow: pNow, bankId, chqNo, chqBank }
    setSubmitting(true)
    const res = mode === 'buy' ? await confirmPurchase(input) : await confirmSale(input)
    setSubmitting(false)
    if (!res.ok) return setError(res.error || 'Could not post this transaction.')
    setLastResult({ amount: amt, rate: r, value, margin, outstanding: mode === 'buy' ? (calc as ReturnType<typeof buyCalc>).outstanding : (calc as ReturnType<typeof sellCalc>).outstanding })
    setStep('done')
  }

  const title = mode === 'buy' ? 'Buy Currency' : 'Sell Currency'
  const sub = mode === 'buy' ? 'Business receives currency, business owes the supplying customer.' : 'Customer receives currency, customer owes the business.'

  return (
    <div className="max-w-[520px]">
      <div className="mb-3">
        <BackButton label="Currency Stock" onBack={() => navigate('/stock')} />
      </div>
      <h1 className="m-0 mb-[3px] text-heading font-semibold">{title}</h1>
      <div className="mb-[26px] text-body text-muted-60">{sub}</div>

      {step === 'form' && (
        <Card className="animate-step flex flex-col gap-3 p-4">
          <div>
            <label className="mb-1 block text-meta font-semibold text-muted-70">{mode === 'buy' ? 'Customer / Supplier' : 'Customer'}</label>
            <Input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Type to filter customers…" className="mb-1.5 h-[30px] text-body" />
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-[34px] w-full rounded-[6px] border border-border-input bg-surface px-2.5 text-body transition-colors duration-150">
              <option value="">Select customer…</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-[0.8fr_1fr_1fr_1fr] gap-2.5">
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-[34px] w-full rounded-[6px] border border-border-input bg-surface px-1.5 text-body font-semibold transition-colors duration-150">
                <option value="AED">AED</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Amount to {mode === 'buy' ? 'buy' : 'sell'}</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="0" className="tabular h-[34px] text-body" />
              {mode === 'sell' && <div className="mt-0.5 text-meta font-normal text-muted-60">Available {fmtNum(avail)}</div>}
            </div>
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">{mode === 'buy' ? 'Purchase rate' : 'Selling rate'}</label>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" placeholder="0.00" className="tabular h-[34px] text-body" />
              <div className="mt-0.5 text-meta font-normal text-muted-60">Avg cost {fmtRate(avgCost)}</div>
            </div>
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">PKR value</label>
              <div className="tabular flex h-[34px] items-center rounded-[6px] border border-border bg-app px-2.5 text-body font-medium">{fmtNum(value)}</div>
            </div>
          </div>

          {mode === 'sell' && (
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[6px] border border-border bg-border">
              <div className="bg-surface-sunken px-2.5 py-2">
                <div className="mb-0.5 text-meta font-medium uppercase tracking-wide text-muted-60">Inventory cost</div>
                <div className="tabular text-body font-medium">{fmtNum(cost || 0)}</div>
              </div>
              <div className="bg-surface-sunken px-2.5 py-2">
                <div className="mb-0.5 text-meta font-medium uppercase tracking-wide text-muted-60">Est. margin</div>
                <SignedAmount value={margin || 0} format={fmtNum} />
              </div>
              <div className="bg-surface-sunken px-2.5 py-2">
                <div className="mb-0.5 text-meta font-medium uppercase tracking-wide text-muted-60">Expected profit</div>
                <SignedAmount value={margin || 0} format={fmtNum} />
              </div>
            </div>
          )}

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

          {method === 'Cheque' && (
            <div className="rounded-[6px] border border-border bg-surface-sunken p-2.5">
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

          {(method === 'Cash' || method === 'Bank' || method === 'Cheque') && (
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted-70">Amount {mode === 'buy' ? 'paid' : 'received'} now (PKR)</label>
              <Input value={paidNow} onChange={(e) => setPaidNow(e.target.value)} type="number" className="tabular h-[34px] text-body" />
            </div>
          )}

          {calc.outstanding > 0 && (
            <div className={`rounded-[6px] px-2.5 py-2 text-body font-normal ${mode === 'buy' ? 'bg-negative-bg text-negative-deep' : 'bg-positive-bg text-positive-text'}`}>
              Creates a <b className="font-semibold">{mode === 'buy' ? 'Payable' : 'Receivable'} of {fmt(calc.outstanding)}</b> {mode === 'buy' ? 'to' : 'from'} {cust?.name || 'this customer'}.
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
          <div className="flex flex-col gap-1.5 text-body">
            <Row label={mode === 'buy' ? 'Supplier' : 'Customer'} value={cust?.name || ''} bold />
            <Row label={mode === 'buy' ? 'Amount' : 'Sell'} value={`${fmtNum(parseFloat(amount) || 0)} ${currency}`} mono />
            <Row label={mode === 'buy' ? 'Purchase rate' : 'Selling rate'} value={fmtRate(parseFloat(rate) || 0)} mono />
            <div className="flex justify-between border-t border-divider pt-2">
              <span className="font-normal text-muted-70">{mode === 'buy' ? 'PKR value' : 'Sale value'}</span>
              <b className="tabular text-body font-semibold">{fmt(value)}</b>
            </div>
            {mode === 'sell' && (
              <>
                <Row label="Inventory cost" value={fmt(cost || 0)} mono />
                <Row label="Margin" value={fmt(margin || 0)} mono positive />
              </>
            )}
            <Row label="Settlement" value={method} bold />
          </div>
          <div className="mt-3 flex flex-col gap-1.5 rounded-[6px] border border-border bg-surface-sunken p-2.5">
            <div className="text-meta font-semibold uppercase tracking-wide text-muted-60">What will happen</div>
            <Bullet color="var(--color-accent)">
              {mode === 'buy' ? `${currency} stock increases by ${fmtNum(parseFloat(amount) || 0)}.` : `${currency} stock decreases by ${fmtNum(parseFloat(amount) || 0)}.`}
            </Bullet>
            <Bullet color="var(--color-accent)">{mode === 'buy' ? 'The weighted-average cost recalculates.' : `Margin of ${fmt(margin || 0)} posts to Income.`}</Bullet>
            <Bullet color={calc.outstanding > 0 ? 'var(--color-pending)' : 'var(--color-positive)'}>
              {calc.outstanding > 0 ? `${fmt(calc.outstanding)} stays outstanding as a ${mode === 'buy' ? 'payable' : 'receivable'}.` : 'Fully settled — nothing stays outstanding.'}
            </Bullet>
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
          <div className={`mb-2 text-meta font-semibold uppercase tracking-wide ${mode === 'buy' ? 'text-accent' : 'text-positive'}`}>{mode === 'buy' ? 'Purchase posted' : 'Sale posted'}</div>
          <div className="mb-3 text-body font-normal">
            {mode === 'buy' ? 'Bought' : 'Sold'} <b className="font-semibold">{fmtNum(lastResult.amount)} {currency}</b> {mode === 'buy' ? 'from' : 'to'} <b className="font-semibold">{cust?.name}</b> at {fmtRate(lastResult.rate)} — {fmt(lastResult.value)} total
            {mode === 'sell' && <> , margin {fmt(lastResult.margin || 0)}</>}.
          </div>
          {lastResult.outstanding > 0 && (
            <div className="mb-3 text-body font-normal">
              {mode === 'buy' ? 'Payable' : 'Receivable'} created: <b className="tabular font-semibold">{fmt(lastResult.outstanding)}</b>
            </div>
          )}
          <div className="flex gap-2">
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
    <div className="flex justify-between">
      <span className="font-normal text-muted-70">{label}</span>
      <span className={`${bold ? 'font-semibold' : 'font-normal'} ${mono ? 'tabular' : ''} ${positive ? 'text-positive' : ''}`}>{value}</span>
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
