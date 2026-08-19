import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { auditLine, relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { ACTIVITY_META, CHEQUE_STATUS_STYLE } from '@/lib/ui-helpers'
import { BackButton } from '@/components/BackButton'

export function CustomerDetail() {
  const { id } = useParams()
  const { state, getAccount } = useStore()
  const navigate = useNavigate()
  const cust = getAccount(id)

  const txns = useMemo(() => (id ? state.activity.filter((t) => t.customerId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) : []), [state.activity, id])

  if (!cust) {
    return (
      <div>
        <BackButton label="All Customers" onBack={() => navigate('/customers')} />
        <div className="mt-6 text-[13px] text-muted-60">Customer not found.</div>
      </div>
    )
  }

  const receivable = cust.receivable || 0
  const payable = cust.payable || 0
  const openingR = cust.openingReceivable || 0
  const openingP = cust.openingPayable || 0
  const settledR = Math.max(openingR - receivable, 0)
  const settledP = Math.max(openingP - payable, 0)
  const pctR = openingR > 0 ? Math.min(100, Math.round((settledR / openingR) * 100)) : receivable === 0 ? 100 : 0
  const pctP = openingP > 0 ? Math.min(100, Math.round((settledP / openingP) * 100)) : payable === 0 ? 100 : 0

  return (
    <div>
      <div className="mb-3">
        <BackButton label="All Customers" onBack={() => navigate('/customers')} />
      </div>
      <div className="mb-3.5 flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 mb-1 text-[19px] font-semibold tracking-tight">{cust.name}</h1>
          <div className="flex items-center gap-2.5 text-[11px] text-muted-60">
            <span className="tabular">{cust.phone}</span>
            <span className="text-muted-42">·</span>
            <span>{cust.city}</span>
            <span className="text-muted-42">·</span>
            <span>Customer since {cust.since}</span>
            <span className="text-muted-42">·</span>
            <span>{txns.length} deals</span>
          </div>
          <div className="mt-1 inline-flex cursor-help items-center gap-1 rounded-[5px] p-1.5 text-[10.5px] text-muted-60 hover:bg-surface-tint hover:text-accent" title={auditLine(cust)}>
            history
          </div>
        </div>
        <div className="flex flex-none gap-2">
          <button disabled={receivable <= 0} onClick={() => navigate('/receive', { state: { customerId: cust.id } })} className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-border-input disabled:bg-surface disabled:text-muted-60">
            Receive Payment
          </button>
          <button disabled={payable <= 0} onClick={() => navigate('/pay', { state: { customerId: cust.id } })} className="rounded-[6px] border border-negative bg-negative px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:border-border-input disabled:bg-surface disabled:text-muted-60">
            Make Payment
          </button>
          <div className="mx-0.5 w-px bg-border-strong" />
          <button onClick={() => navigate('/sale', { state: { customerId: cust.id } })} className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint">
            Sell Currency
          </button>
          <button onClick={() => navigate('/purchase', { state: { customerId: cust.id } })} className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint">
            Buy Currency
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="overflow-hidden rounded-[8px] border border-border border-l-[3px] border-l-positive bg-surface">
          <div className="flex items-center gap-1.5 border-b border-divider px-3.5 py-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-positive" />
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-70">Receivable — owed to you</div>
          </div>
          <div className="px-3.5 pb-3.5 pt-3">
            <div className="flex items-baseline justify-between py-1">
              <span className="text-[11.5px] text-muted-70">Original</span>
              <span className="tabular text-[13px]">{fmt(openingR)}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-divider py-1">
              <span className="text-[11.5px] text-muted-70">Settled</span>
              <span className="tabular text-[13px] text-muted-60">− {fmt(settledR)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Remaining</span>
              <span className="tabular text-[24px] font-medium tracking-tight text-positive">{fmt(receivable)}</span>
            </div>
            <div className="mt-2.5 h-[3px] overflow-hidden rounded-[2px] bg-divider">
              <div className="h-full bg-positive" style={{ width: `${pctR}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-muted-60">{pctR}% settled</div>
          </div>
        </div>
        <div className="overflow-hidden rounded-[8px] border border-border border-l-[3px] border-l-negative bg-surface">
          <div className="flex items-center gap-1.5 border-b border-divider px-3.5 py-2.5">
            <div className="h-1.5 w-1.5 rounded-full bg-negative" />
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-70">Payable — you owe</div>
          </div>
          <div className="px-3.5 pb-3.5 pt-3">
            <div className="flex items-baseline justify-between py-1">
              <span className="text-[11.5px] text-muted-70">Original</span>
              <span className="tabular text-[13px]">{fmt(openingP)}</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-divider py-1">
              <span className="text-[11.5px] text-muted-70">Settled</span>
              <span className="tabular text-[13px] text-muted-60">− {fmt(settledP)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Remaining</span>
              <span className="tabular text-[24px] font-medium tracking-tight text-negative">{fmt(payable)}</span>
            </div>
            <div className="mt-2.5 h-[3px] overflow-hidden rounded-[2px] bg-divider">
              <div className="h-full bg-negative" style={{ width: `${pctP}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-muted-60">{pctP}% settled</div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-[13px] py-2.5">
          <div className="text-[12.5px] font-semibold">Transaction history</div>
          <div className="text-[11px] text-muted-60">{cust.name} only</div>
        </div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[86px]">Type</div>
          <div className="flex-1">Detail</div>
          <div className="min-w-[70px]">Status</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[62px] text-right">Date</div>
        </div>
        {txns.map((t) => {
          const meta = ACTIVITY_META[t.type]
          const Icon = meta.icon
          const cheque = t.chequeId ? state.cheques.find((q) => q.id === t.chequeId) : undefined
          const status = cheque ? cheque.status : t.outstanding ? 'Open' : 'Settled'
          const style = cheque ? CHEQUE_STATUS_STYLE[cheque.status] : t.outstanding ? CHEQUE_STATUS_STYLE.Pending : CHEQUE_STATUS_STYLE.Cleared
          const detail = t.type === 'sale' || t.type === 'purchase' ? `${t.amount?.toLocaleString('en-US')} ${t.currency} @ ${t.rate}` : `via ${t.method}`
          return (
            <div key={t.id} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2">
              <div className="flex min-w-[102px] items-center gap-1.5">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px]" style={{ background: meta.chipBg, color: meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} />
                </div>
                <span className="text-[12px] font-semibold text-ink">{meta.label}</span>
              </div>
              <div className="flex-1 text-[12.5px] text-muted-70">{detail}</div>
              <div className="min-w-[70px]">
                <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: style.bg, color: style.color }}>
                  {status}
                </span>
              </div>
              <div className="tabular min-w-[110px] text-right text-[12.5px] font-medium">{fmt(t.pkrValue)}</div>
              <div className="min-w-[62px] text-right text-[11px] text-muted-60">{relLabel(t.createdAt)}</div>
            </div>
          )
        })}
      </div>
      {txns.length === 0 && <div className="py-8 text-center text-[12.5px] text-muted-60">No transactions yet with {cust.name}.</div>}
    </div>
  )
}
