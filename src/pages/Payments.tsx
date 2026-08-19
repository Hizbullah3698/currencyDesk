import { useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { relLabel } from '@/lib/engine'
import { fmt } from '@/lib/format'
import { ACTIVITY_META } from '@/lib/ui-helpers'

export function Payments() {
  const { state } = useStore()
  const navigate = useNavigate()
  const rows = state.activity.filter((t) => t.type === 'receive' || t.type === 'pay')

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between gap-2.5">
        <h1 className="m-0 text-[17px] font-semibold">Payments</h1>
        <div className="flex gap-2">
          <button onClick={() => navigate('/receive')} className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white hover:bg-accent-hover">
            Receive Payment
          </button>
          <button onClick={() => navigate('/pay')} className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold hover:bg-surface-tint">
            Make Payment
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[108px]">Direction</div>
          <div className="flex-1">Customer</div>
          <div className="min-w-[70px]">Method</div>
          <div className="min-w-[110px] text-right">Amount</div>
          <div className="min-w-[62px] text-right">Date</div>
        </div>
        {rows.map((t) => {
          const meta = ACTIVITY_META[t.type]
          const Icon = meta.icon
          return (
            <div key={t.id} onClick={() => t.customerId && navigate(`/customers/${t.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 hover:bg-surface-hover">
              <div className="flex min-w-[108px] items-center gap-1.5">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px]" style={{ background: meta.chipBg, color: meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} />
                </div>
                <span className="text-[12px] font-semibold">{meta.label}</span>
              </div>
              <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{t.customerName}</div>
              <div className="min-w-[70px] text-[12px] text-muted-70">{t.method}</div>
              <div className="tabular min-w-[110px] text-right text-[12.5px] font-medium">{fmt(t.pkrValue)}</div>
              <div className="min-w-[62px] text-right text-[11px] text-muted-60">{relLabel(t.createdAt)}</div>
            </div>
          )
        })}
      </div>
      {rows.length === 0 && (
        <div className="py-11 text-center">
          <div className="mb-1 text-[12.5px] font-semibold">No payments recorded yet</div>
          <div className="mb-3 text-[12px] text-muted-60">Payments settle a specific receivable or payable. Record the first one to see it here.</div>
          <button onClick={() => navigate('/receive')} className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white hover:bg-accent-hover">
            Receive Payment
          </button>
        </div>
      )}
    </div>
  )
}
