import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import type { SettlementMethod } from '@/lib/types'
import { BackButton } from '@/components/BackButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const METHODS: SettlementMethod[] = ['Cash', 'Bank', 'Cheque']

export function Settle({ mode }: { mode: 'receive' | 'pay' }) {
  const { state, confirmReceive, confirmPay, getAccount } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const presetCustomerId = (location.state as { customerId?: string } | null)?.customerId || ''

  const [step, setStep] = useState<'form' | 'review' | 'done'>('form')
  const [customerId, setCustomerId] = useState(presetCustomerId)
  const [custSearch, setCustSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<SettlementMethod>('Bank')
  const [bankId, setBankId] = useState(state.accounts.find((a) => a.type === 'Bank')?.id || 'bank')
  const [chqNo, setChqNo] = useState('')
  const [chqBank, setChqBank] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [posted, setPosted] = useState<{ amount: number; remaining: number } | null>(null)

  const customers = state.accounts.filter((a) => a.type === 'Customer')
  const q = custSearch.trim().toLowerCase()
  const filtered = q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers
  const cust = getAccount(customerId)
  const banks = state.accounts.filter((a) => a.type === 'Bank')
  const outstanding = mode === 'receive' ? cust?.receivable || 0 : cust?.payable || 0
  const amt = parseFloat(amount) || 0
  const remaining = Math.max(outstanding - amt, 0)

  function review() {
    if (!cust) return setError('Select a customer.')
    if (amt <= 0 || amt > outstanding) return setError(`Enter an amount between 1 and the outstanding ${mode === 'receive' ? 'receivable' : 'payable'}.`)
    setError('')
    setStep('review')
  }

  async function confirm() {
    const input = { customerId, amount: amt, method, bankId, chqNo, chqBank }
    setSubmitting(true)
    const res = mode === 'receive' ? await confirmReceive(input) : await confirmPay(input)
    setSubmitting(false)
    if (!res.ok) return setError(res.error || 'Could not post this payment.')
    setPosted({ amount: amt, remaining: method === 'Cheque' ? outstanding : remaining })
    setStep('done')
  }

  const title = mode === 'receive' ? 'Receive Payment' : 'Make Payment'

  return (
    <div className="max-w-[460px]">
      <div className="mb-3">
        <BackButton label={cust ? cust.name : 'Overview'} onBack={() => navigate(-1)} />
      </div>
      <h1 className="m-0 mb-[3px] text-heading font-semibold">{title}</h1>
      <div className="mb-[26px] text-body text-muted-60">Applies against the customer's outstanding {mode === 'receive' ? 'receivable' : 'payable'}.</div>

      {step === 'form' && (
        <Card className="animate-step flex flex-col gap-3 p-4">
          <div>
            <label className="mb-1 block text-meta font-semibold text-muted-70">Customer</label>
            <Input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Type to filter customers…" className="mb-1.5 h-[30px] text-body" />
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-[34px] w-full rounded-control border border-border-input bg-surface px-2.5 text-body transition-colors duration-150">
              <option value="">Select customer…</option>
              {filtered.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {cust && (
            <div className={`rounded-control px-2.5 py-2.5 ${mode === 'receive' ? 'bg-positive-bg' : 'bg-negative-bg'}`}>
              <div className={`mb-0.5 text-body font-normal ${mode === 'receive' ? 'text-positive-text' : 'text-negative-deep'}`}>{mode === 'receive' ? 'Outstanding receivable' : 'Outstanding payable'}</div>
              <b className={`tabular text-body font-medium tracking-tight ${mode === 'receive' ? 'text-positive-text' : 'text-negative-deep'}`}>{fmt(outstanding)}</b>
            </div>
          )}
          <div>
            <label className="mb-1 block text-meta font-semibold text-muted-70">Amount {mode === 'receive' ? 'received' : 'paid'} (PKR)</label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="0" className="tabular h-[34px] text-body" />
          </div>
          <div>
            <label className="mb-1.5 block text-meta font-semibold text-muted-70">Payment method</label>
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
          {method === 'Bank' && (
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
          )}
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
              <div className="mt-2 text-meta font-normal leading-[1.45] text-muted-60">Recorded as a pending {mode === 'receive' ? 'inward' : 'outward'} cheque. The {mode === 'receive' ? 'receivable' : 'payable'} is unchanged until the cheque clears.</div>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-divider pt-2.5">
            <span className="text-meta font-normal text-muted-70">Remaining after payment</span>
            <div className="tabular flex items-baseline gap-1.5">
              <span className="text-body font-normal text-muted-60 line-through">{fmt(outstanding)}</span>
              <span className="text-body text-muted-42" aria-hidden="true">→</span>
              <b className="text-body font-medium">{fmt(method === 'Cheque' ? outstanding : remaining)}</b>
            </div>
          </div>
          {error && <div className="text-body font-semibold text-negative">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={review}>
              Review Payment
            </Button>
          </div>
        </Card>
      )}

      {step === 'review' && cust && (
        <Card variant="flat" className="animate-step p-4">
          <div className="mb-2.5 text-meta font-semibold uppercase tracking-wide text-muted-60">Review payment</div>
          <div className="flex flex-col gap-1.5 text-body">
            <div className="flex justify-between">
              <span className="font-normal text-muted-70">Customer</span>
              <b className="font-semibold">{cust.name}</b>
            </div>
            <div className="flex justify-between">
              <span className="font-normal text-muted-70">{mode === 'receive' ? 'Receivable' : 'Payable'} (original)</span>
              <b className="tabular font-semibold">{fmt(outstanding)}</b>
            </div>
            <div className="flex justify-between">
              <span className="font-normal text-muted-70">Amount {mode === 'receive' ? 'received' : 'paid'}</span>
              <b className="tabular font-semibold">{fmt(amt)}</b>
            </div>
            <div className="flex justify-between border-t border-divider pt-2">
              <span className="font-normal text-muted-70">Remaining</span>
              <b className="tabular text-body font-semibold">{fmt(method === 'Cheque' ? outstanding : remaining)}</b>
            </div>
            {method === 'Cheque' && <div className="rounded-control border border-border bg-surface-sunken px-2.5 py-2 text-meta font-normal leading-[1.45] text-muted-70">Held as a pending cheque — the balance won't move until it clears.</div>}
            <div className="flex justify-between">
              <span className="font-normal text-muted-70">Method</span>
              <b className="font-semibold">{method}</b>
            </div>
          </div>
          {error && <div className="mt-3 text-body font-semibold text-negative">{error}</div>}
          <div className="mt-3.5 flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => setStep('form')}>
              Back
            </Button>
            <Button type="button" variant="primary" disabled={submitting} onClick={confirm}>
              {submitting ? 'Posting…' : 'Confirm Payment'}
            </Button>
          </div>
        </Card>
      )}

      {step === 'done' && posted && (
        <Card variant="flat" className={cn('animate-step border-l-[3px] p-4', mode === 'receive' ? 'border-l-positive' : 'border-l-negative')}>
          <div className={`mb-2 text-meta font-semibold uppercase tracking-wide ${mode === 'receive' ? 'text-positive' : 'text-negative'}`}>{mode === 'receive' ? 'Payment received' : 'Payment made'}</div>
          <div className="text-body font-normal leading-[1.6]">
            {mode === 'receive' ? 'Received' : 'Paid'} {fmt(posted.amount)} {mode === 'receive' ? 'from' : 'to'} <b className="font-semibold">{cust?.name}</b>.
          </div>
          <div className="mb-3.5 mt-1.5 text-body font-normal leading-[1.6]">
            Remaining: <b className="tabular font-semibold">{fmt(posted.remaining)}</b>.
          </div>
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
