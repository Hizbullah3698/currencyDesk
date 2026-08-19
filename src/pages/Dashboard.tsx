import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { isToday, stk, stockTrend } from '@/lib/engine'
import { fmt, fmtNum, fmtRate } from '@/lib/format'
import { ACTIVITY_META } from '@/lib/ui-helpers'
import { CHEQUE_STATUS_STYLE } from '@/lib/ui-helpers'

export function Dashboard() {
  const { state } = useStore()
  const navigate = useNavigate()

  const stats = useMemo(() => {
    const todaySales = state.activity.filter((t) => t.type === 'sale' && isToday(t.createdAt))
    const todayPurchases = state.activity.filter((t) => t.type === 'purchase' && isToday(t.createdAt))
    const inflow = state.activity
      .filter((t) => isToday(t.createdAt) && (t.type === 'sale' || t.type === 'receive') && t.method !== 'Cheque' && t.method !== 'Credit')
      .reduce((s, t) => s + (t.type === 'sale' ? t.paidNow || 0 : t.amount), 0)
    const outflow = state.activity
      .filter((t) => isToday(t.createdAt) && (t.type === 'purchase' || t.type === 'pay') && t.method !== 'Cheque' && t.method !== 'Credit')
      .reduce((s, t) => s + (t.type === 'purchase' ? t.paidNow || 0 : t.amount), 0)
    return {
      salesValue: todaySales.reduce((s, t) => s + t.pkrValue, 0),
      salesCount: todaySales.length,
      purchasesValue: todayPurchases.reduce((s, t) => s + t.pkrValue, 0),
      inflow,
      outflow,
      net: inflow - outflow,
    }
  }, [state.activity])

  const recent = state.activity.slice(0, 6)
  const uncleared = state.cheques.filter((q) => q.status === 'Pending' || q.status === 'Deposited')
  const unclearedIn = uncleared.filter((q) => q.direction === 'Inward').reduce((s, q) => s + q.amount, 0)
  const unclearedOut = uncleared.filter((q) => q.direction === 'Outward').reduce((s, q) => s + q.amount, 0)
  const aed = stk(state.stocks, 'AED')
  const trend = stockTrend('AED', state.stocks, state.activity)

  return (
    <div>
      <div className="mb-[26px] flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 mb-[3px] text-[22px] font-semibold tracking-tight">Dashboard</h1>
          <div className="text-[12px] text-muted-70">Trading day {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/purchase')} className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-tint">
            Buy Currency
          </button>
          <button onClick={() => navigate('/sale')} className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover">
            Sell Currency
          </button>
        </div>
      </div>

      <div className="mb-[34px] grid grid-cols-3 gap-5">
        <div className="rounded-[8px] border border-border bg-surface px-[22px] pb-[22px] pt-5">
          <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-60">Sales today</div>
          <div className="tabular text-[clamp(22px,2.4vw,30px)] leading-[1.05] tracking-tight text-ink">{fmt(stats.salesValue)}</div>
          <div className="mt-2.5 text-[11px] text-muted-60">{stats.salesCount} sales booked</div>
        </div>
        <div className="rounded-[8px] border border-border bg-surface px-[22px] pb-[22px] pt-5">
          <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-60">Purchases today</div>
          <div className="tabular text-[clamp(22px,2.4vw,30px)] leading-[1.05] tracking-tight text-ink">{fmt(stats.purchasesValue)}</div>
          <div className="mt-2.5 text-[11px] text-muted-60">Cost of AED taken in today</div>
        </div>
        <div className="rounded-[8px] border border-border bg-surface px-[22px] pb-[22px] pt-5">
          <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-60">Net cash movement</div>
          <div className={`tabular text-[clamp(22px,2.4vw,30px)] leading-[1.05] tracking-tight ${stats.net >= 0 ? 'text-positive' : 'text-negative'}`}>{fmt(Math.abs(stats.net))}</div>
          <div className="mt-2.5 text-[11px] text-muted-60">
            In {fmt(stats.inflow)} · out {fmt(stats.outflow)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1.65fr_1fr] items-start gap-5">
        <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-[13px] py-2.5">
            <div className="text-[13.5px] font-semibold tracking-tight">Recent activity</div>
            <button onClick={() => navigate('/transactions')} className="cursor-pointer text-[11.5px] text-accent hover:text-accent-hover">
              All transactions →
            </button>
          </div>
          <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
            <div className="w-5 flex-none" />
            <div className="w-[88px] flex-none">Type</div>
            <div className="min-w-[66px] flex-1">Party</div>
            <div className="min-w-[66px] flex-none">Status</div>
            <div className="min-w-[92px] flex-none text-right">Amount</div>
          </div>
          {recent.map((row) => {
            const meta = ACTIVITY_META[row.type]
            const Icon = meta.icon
            const cheque = row.chequeId ? state.cheques.find((q) => q.id === row.chequeId) : undefined
            const statusLabel = cheque ? cheque.status : row.type === 'sale' || row.type === 'purchase' ? (row.outstanding ? 'Open' : 'Settled') : 'Posted'
            const statusStyle = cheque ? CHEQUE_STATUS_STYLE[cheque.status] : row.outstanding ? CHEQUE_STATUS_STYLE.Pending : CHEQUE_STATUS_STYLE.Cleared
            return (
              <div key={row.id} onClick={() => row.customerId && navigate(`/customers/${row.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors hover:bg-surface-hover">
                <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px]" style={{ background: meta.chipBg, color: meta.chipColor }}>
                  <Icon size={13} strokeWidth={2.2} />
                </div>
                <div className="w-[88px] flex-none text-[12px] font-semibold text-ink">{meta.label}</div>
                <div className="min-w-[66px] flex-1 overflow-hidden">
                  <div className="truncate text-[12.5px]">{row.customerName}</div>
                  <div className="text-[10.5px] text-muted-60">{new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <div className="min-w-[66px] flex-none">
                  <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                    {statusLabel}
                  </span>
                </div>
                <div className="tabular min-w-[92px] flex-none text-right text-[12.5px] font-medium">{fmt(row.pkrValue)}</div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-col gap-5">
          <div onClick={() => navigate('/cheques')} className="cursor-pointer rounded-[8px] border border-border bg-surface p-[13px] transition-colors hover:bg-surface-sunken">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[13.5px] font-semibold tracking-tight">Uncleared cheques</div>
              <span className="text-[11.5px] text-accent">Cheques →</span>
            </div>
            <div className="tabular text-[clamp(18px,1.75vw,23px)] leading-[1.1] tracking-tight">{fmt(unclearedIn + unclearedOut)}</div>
            <div className="mt-0.5 text-[10.5px] text-muted-60">{uncleared.length} not yet cleared — no balance moved</div>
            <div className="mt-2.5 flex gap-4 border-t border-divider pt-2">
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Inward</div>
                <div className="tabular text-[13px] text-positive">{fmt(unclearedIn)}</div>
              </div>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Outward</div>
                <div className="tabular text-[13px] text-muted-70">{fmt(unclearedOut)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-[8px] border border-border bg-surface p-[13px]">
            <div className="mb-2.5 flex items-baseline justify-between">
              <div className="text-[13.5px] font-semibold tracking-tight">AED stock</div>
              <button onClick={() => navigate('/stock')} className="cursor-pointer text-[11.5px] text-accent hover:text-accent-hover">
                Details →
              </button>
            </div>
            <div className="tabular text-[clamp(18px,1.75vw,23px)] font-medium leading-[1.1] tracking-tight">{fmtNum(aed.available)}</div>
            <div className="mt-2 flex gap-4 border-t border-divider pt-2">
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Avg cost</div>
                <div className="tabular text-[13px]">{fmtRate(aed.avgCost)}</div>
              </div>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Inventory value</div>
                <div className="tabular text-[13px]">{fmt(aed.available * aed.avgCost)}</div>
              </div>
            </div>
            <div className="mt-3 flex h-11 items-end gap-1">
              {trend.map((bar, i) => (
                <div key={i} className="flex-1 rounded-t-[2px]" style={{ background: bar.color, height: `${bar.heightPct}%`, minHeight: 3 }} />
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
            <div className="border-b border-border px-3.5 py-3 text-[13.5px] font-semibold tracking-tight">Quick actions</div>
            {[
              { label: 'Receive Payment', to: '/receive' },
              { label: 'Make Payment', to: '/pay' },
              { label: 'Customers', to: '/customers' },
              { label: 'Cheques', to: '/cheques' },
            ].map((a, i, arr) => (
              <div key={a.to} onClick={() => navigate(a.to)} className={`flex cursor-pointer items-center justify-between px-[13px] py-2.5 transition-colors hover:bg-surface-hover ${i < arr.length - 1 ? 'border-b border-divider' : ''}`}>
                <span className="text-[12.5px] font-medium">{a.label}</span>
                <span className="text-muted-60">→</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
