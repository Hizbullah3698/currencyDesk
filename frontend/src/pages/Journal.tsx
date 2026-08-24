import { useState } from 'react'
import { SquarePen } from 'lucide-react'
import { useStore } from '@/lib/store'
import { ACCOUNT_TYPES } from '@/lib/types'
import { fmt } from '@/lib/format'
import { statusMeta } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

export function Journal() {
  const { state, postJournal } = useStore()
  const [debitAccount, setDebitAccount] = useState('')
  const [debitAmount, setDebitAmount] = useState('')
  const [creditAccount, setCreditAccount] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [narration, setNarration] = useState('')
  const [error, setError] = useState('')

  const options = state.accounts.slice().sort((a, b) => ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type) || a.name.localeCompare(b.name))
  const dr = parseFloat(debitAmount) || 0
  const cr = parseFloat(creditAmount) || 0
  const balanced = dr > 0 && dr === cr
  const status = statusMeta(balanced ? 'Balanced' : 'Not balanced')
  const StatusIcon = status.icon

  function reset() {
    setDebitAccount('')
    setDebitAmount('')
    setCreditAccount('')
    setCreditAmount('')
    setNarration('')
    setError('')
  }

  function post() {
    const err = postJournal({ debitAccount, debitAmount: dr, creditAccount, creditAmount: cr, narration })
    if (err) return setError(err)
    reset()
  }

  return (
    <div>
      <h1 className="m-0 mb-[3px] text-[17px] font-semibold">Journal Entry</h1>
      <div className="mb-3.5 text-[12px] font-normal text-muted-60">Free-form double entry against any two accounts. Total debit must equal total credit; amounts post exactly as entered.</div>

      <Card className="max-w-[820px] overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[70px]">Line</div>
          <div className="flex-1">Account</div>
          <div className="min-w-[140px] text-right">Debit</div>
          <div className="min-w-[140px] text-right">Credit</div>
        </div>
        <div className="flex items-start gap-2.5 border-b border-divider px-[13px] py-2.5">
          <div className="min-w-[70px] pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-60">Debit</div>
          <div className="flex-1">
            <select value={debitAccount} onChange={(e) => setDebitAccount(e.target.value)} className="h-[34px] w-full rounded-[6px] border border-border-input bg-surface px-2.5 text-[12.5px] transition-colors duration-150">
              <option value="">Select account…</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[140px]">
            <Input value={debitAmount} onChange={(e) => setDebitAmount(e.target.value)} type="number" placeholder="0" className="tabular h-[34px] text-right text-[12.5px]" />
          </div>
          <div className="flex h-[34px] min-w-[140px] items-center justify-end text-[12.5px] font-normal text-muted-42">—</div>
        </div>
        <div className="flex items-start gap-2.5 border-b border-border px-[13px] py-2.5">
          <div className="min-w-[70px] pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-60">Credit</div>
          <div className="flex-1">
            <select value={creditAccount} onChange={(e) => setCreditAccount(e.target.value)} className="h-[34px] w-full rounded-[6px] border border-border-input bg-surface px-2.5 text-[12.5px] transition-colors duration-150">
              <option value="">Select account…</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type})
                </option>
              ))}
            </select>
          </div>
          <div className="flex h-[34px] min-w-[140px] items-center justify-end text-[12.5px] font-normal text-muted-42">—</div>
          <div className="min-w-[140px]">
            <Input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} type="number" placeholder="0" className="tabular h-[34px] text-right text-[12.5px]" />
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-2">
          <div className="min-w-[70px]" />
          <div className="flex flex-1 items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-60">Totals</span>
            <Badge variant={status.variant}>
              <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
              {balanced ? 'Balanced' : 'Not balanced'}
            </Badge>
          </div>
          <div className="tabular min-w-[140px] text-right text-[13px] font-semibold">{fmt(dr)}</div>
          <div className="tabular min-w-[140px] text-right text-[13px] font-semibold">{fmt(cr)}</div>
        </div>
        <div className="flex flex-col gap-2.5 p-3.5">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-70">Narration</label>
            <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What this entry records" className="h-[34px] text-[12.5px]" />
          </div>
          {error && <div className="rounded-[6px] border border-negative-border bg-negative-bg px-2.5 py-2 text-[12px] font-normal leading-[1.5] text-negative-deep">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>
              Clear
            </Button>
            <Button variant="primary" onClick={post}>
              <SquarePen size={14} strokeWidth={2} aria-hidden="true" />
              Post Entry
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mt-4 max-w-[820px] overflow-hidden">
        <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Posted entries</div>
        {state.journalEntries.length === 0 && <EmptyState icon={SquarePen} title="No journal entries posted yet" description="Free-form debit/credit postings you record will show up here." className="py-8" />}
        {state.journalEntries.map((e) => (
          <div key={e.id} className="border-b border-divider px-[13px] py-2.5">
            <div className="flex items-baseline gap-2.5">
              <div className="tabular min-w-[52px] text-[11px] font-normal text-muted-60">{e.ref}</div>
              <div className="flex-1 text-[12.5px] font-normal">{e.narration}</div>
              <div className="tabular text-[12.5px] font-medium">{fmt(e.amount)}</div>
            </div>
            <div className="mt-1 flex gap-4 text-[11.5px] font-normal text-muted-70">
              <span>
                Dr <b className="font-semibold text-ink">{e.debitLabel}</b>
              </span>
              <span>
                Cr <b className="font-semibold text-ink">{e.creditLabel}</b>
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
