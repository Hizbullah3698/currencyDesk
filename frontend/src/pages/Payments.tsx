import { useNavigate } from 'react-router-dom'
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { activityDate, relLabel } from '@/lib/engine'
import { txnAmountParts } from '@/lib/format'
import { ACTIVITY_META } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export function Payments() {
  const { state } = useStore()
  const navigate = useNavigate()
  const rows = state.activity.filter((t) => t.type === 'receive' || t.type === 'pay')

  return (
    <div>
      <div className="mb-[26px] flex items-center justify-between gap-2.5">
        <h1 className="m-0 text-heading font-semibold">Payments</h1>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate('/receive')}>
            <ArrowDownCircle size={14} strokeWidth={2} aria-hidden="true" />
            Receive Payment
          </Button>
          <Button variant="secondary" onClick={() => navigate('/pay')}>
            <ArrowUpCircle size={14} strokeWidth={2} aria-hidden="true" />
            Make Payment
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
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
            <div key={t.id} onClick={() => t.customerId && navigate(`/customers/${t.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="flex min-w-[108px] items-center gap-1.5">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-data" style={{ background: meta.chipBg, color: meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <span className="text-body font-medium">{meta.label}</span>
              </div>
              <div className="min-w-0 flex-1 truncate text-body font-semibold">{t.customerName}</div>
              <div className="min-w-[70px] text-body font-normal text-muted-70">{t.method}</div>
              {/* Routed through the same helper as every other screen. Receipts and payments move
                  rupees and nothing else, so it returns the rupee amount with no conversion line —
                  the uniformity is the point, not a change in what this shows. */}
              <div className="tabular min-w-[110px] text-right text-body font-medium">{txnAmountParts(t).primary}</div>
              <div className="min-w-[62px] text-right text-meta font-normal text-muted-60">{relLabel(activityDate(t))}</div>
            </div>
          )
        })}
      </Card>
      {rows.length === 0 && (
        <EmptyState category="customers"
          icon={ArrowDownCircle}
          title="No payments recorded yet"
          description="Payments settle a specific receivable or payable. Record the first one to see it here."
          action={
            <Button variant="primary" onClick={() => navigate('/receive')}>
              <ArrowDownCircle size={14} strokeWidth={2} aria-hidden="true" />
              Receive Payment
            </Button>
          }
        />
      )}
    </div>
  )
}
