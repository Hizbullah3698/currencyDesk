import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Wallet, Coins, Inbox } from 'lucide-react'
import { useStore } from '@/lib/store'
import { isToday, stk, stockTrend } from '@/lib/engine'
import { fmt, fmtNum, fmtRate } from '@/lib/format'
import { ACTIVITY_META, statusMeta, CATEGORY_COLORS } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useBootReady } from '@/lib/useBootReady'

export function Dashboard() {
  const { state } = useStore()
  const navigate = useNavigate()
  const ready = useBootReady()

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
          <div className="text-[12px] font-normal text-muted-70">Trading day {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate('/purchase')}>
            <ArrowDownToLine size={14} strokeWidth={2} aria-hidden="true" />
            Buy Currency
          </Button>
          <Button variant="primary" onClick={() => navigate('/sale')}>
            <ArrowUpFromLine size={14} strokeWidth={2} aria-hidden="true" />
            Sell Currency
          </Button>
        </div>
      </div>

      <div className="mb-[34px] grid grid-cols-3 gap-5">
        {!ready ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <Card className="px-[22px] pb-[22px] pt-5">
              <CatLabel category="fx" icon={ArrowUpFromLine} label="Sales today" />
              <div className="tabular text-[clamp(22px,2.4vw,30px)] font-semibold leading-[1.05] tracking-tight text-ink">{fmt(stats.salesValue)}</div>
              <div className="mt-2.5 text-[11px] font-normal text-muted-60">{stats.salesCount} sales booked</div>
            </Card>
            <Card className="px-[22px] pb-[22px] pt-5">
              <CatLabel category="fx" icon={ArrowDownToLine} label="Purchases today" />
              <div className="tabular text-[clamp(22px,2.4vw,30px)] font-semibold leading-[1.05] tracking-tight text-ink">{fmt(stats.purchasesValue)}</div>
              <div className="mt-2.5 text-[11px] font-normal text-muted-60">Cost of AED taken in today</div>
            </Card>
            <Card className="px-[22px] pb-[22px] pt-5">
              <CatLabel category="bank" icon={Wallet} label="Net cash movement" />
              <div className="tabular text-[clamp(22px,2.4vw,30px)] font-semibold leading-[1.05] tracking-tight text-accent">{fmt(Math.abs(stats.net))}</div>
              <div className="mt-2.5 text-[11px] font-normal text-muted-60">
                In {fmt(stats.inflow)} · out {fmt(stats.outflow)}
              </div>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-[1.65fr_1fr] items-start gap-5">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-[13px] py-2.5">
            <div className="text-[13.5px] font-semibold tracking-tight">Recent activity</div>
            <button onClick={() => navigate('/transactions')} className="cursor-pointer text-[11.5px] font-medium text-accent transition-colors duration-150 hover:text-accent-hover">
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
          {!ready ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
          ) : recent.length === 0 ? (
            <EmptyState icon={Inbox} title="No activity yet" description="Purchases, sales, payments and cheques will show up here as you record them." />
          ) : (
            recent.map((row) => {
              const meta = ACTIVITY_META[row.type]
              const Icon = meta.icon
              const cheque = row.chequeId ? state.cheques.find((q) => q.id === row.chequeId) : undefined
              const statusLabel = cheque ? cheque.status : row.type === 'sale' || row.type === 'purchase' ? (row.outstanding ? 'Open' : 'Settled') : 'Posted'
              const status = statusMeta(statusLabel)
              const StatusIcon = status.icon
              return (
                <div key={row.id} onClick={() => row.customerId && navigate(`/customers/${row.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
                  <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px]" style={{ background: meta.chipBg, color: meta.chipColor }}>
                    <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                  </div>
                  <div className="w-[88px] flex-none text-[12px] font-medium text-ink">{meta.label}</div>
                  <div className="min-w-[66px] flex-1 overflow-hidden">
                    <div className="truncate text-[12.5px] font-semibold">{row.customerName}</div>
                    <div className="text-[10.5px] font-normal text-muted-60">{new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </div>
                  <div className="min-w-[66px] flex-none">
                    <Badge variant={status.variant}>
                      <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="tabular min-w-[92px] flex-none text-right text-[12.5px] font-medium">{fmt(row.pkrValue)}</div>
                </div>
              )
            })
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card onClick={() => navigate('/cheques')} className="cursor-pointer p-[13px] transition-[box-shadow,background-color] duration-150 hover:bg-surface-sunken hover:shadow-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-[13.5px] font-semibold tracking-tight">Uncleared cheques</div>
              <span className="text-[11.5px] font-medium text-accent">Cheques →</span>
            </div>
            {!ready ? (
              <SideCardSkeleton />
            ) : (
              <>
                <div className="tabular text-[clamp(18px,1.75vw,23px)] font-semibold leading-[1.1] tracking-tight">{fmt(unclearedIn + unclearedOut)}</div>
                <div className="mt-0.5 text-[10.5px] font-normal text-muted-60">{uncleared.length} not yet cleared — no balance moved</div>
                <div className="mt-2.5 flex gap-4 border-t border-divider pt-2">
                  <div>
                    <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Inward</div>
                    <div className="tabular text-[13px] font-medium text-positive">{fmt(unclearedIn)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Outward</div>
                    <div className="tabular text-[13px] font-medium text-muted-70">{fmt(unclearedOut)}</div>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card className="p-[13px]">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-[5px]" style={{ background: CATEGORY_COLORS.fx.bg, color: CATEGORY_COLORS.fx.color }}>
                  <Coins size={11} strokeWidth={2.2} aria-hidden="true" />
                </span>
                <span className="text-[13.5px] font-semibold tracking-tight">AED stock</span>
              </div>
              <button onClick={() => navigate('/stock')} className="cursor-pointer text-[11.5px] font-medium text-accent transition-colors duration-150 hover:text-accent-hover">
                Details →
              </button>
            </div>
            {!ready ? (
              <SideCardSkeleton chart />
            ) : (
              <>
                <div className="tabular text-[clamp(18px,1.75vw,23px)] font-semibold leading-[1.1] tracking-tight">{fmtNum(aed.available)}</div>
                <div className="mt-2 flex gap-4 border-t border-divider pt-2">
                  <div>
                    <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Avg cost</div>
                    <div className="tabular text-[13px] font-medium">{fmtRate(aed.avgCost)}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-60">Inventory value</div>
                    <div className="tabular text-[13px] font-medium">{fmt(aed.available * aed.avgCost)}</div>
                  </div>
                </div>
                <div className="mt-3 flex h-11 items-end gap-1">
                  {trend.map((bar, i) => (
                    <div key={i} className="flex-1 rounded-t-[2px] transition-[height] duration-300 ease-out" style={{ background: bar.color, height: `${bar.heightPct}%`, minHeight: 3 }} />
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-3.5 py-3 text-[13.5px] font-semibold tracking-tight">Quick actions</div>
            {[
              { label: 'Receive Payment', to: '/receive' },
              { label: 'Make Payment', to: '/pay' },
              { label: 'Customers', to: '/customers' },
              { label: 'Cheques', to: '/cheques' },
            ].map((a, i, arr) => (
              <div key={a.to} onClick={() => navigate(a.to)} className={`flex cursor-pointer items-center justify-between px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover ${i < arr.length - 1 ? 'border-b border-divider' : ''}`}>
                <span className="text-[12.5px] font-medium">{a.label}</span>
                <span className="text-muted-60" aria-hidden="true">→</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatTileSkeleton() {
  return (
    <Card className="px-[22px] pb-[22px] pt-5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Skeleton className="h-[19px] w-[19px] rounded-[5px]" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <Skeleton className="h-7 w-32" />
      <Skeleton className="mt-2.5 h-2.5 w-28" />
    </Card>
  )
}

function SideCardSkeleton({ chart }: { chart?: boolean }) {
  return (
    <>
      <Skeleton className="h-6 w-28" />
      <Skeleton className="mt-2 h-2.5 w-40" />
      <div className="mt-2.5 flex gap-4 border-t border-divider pt-2">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      </div>
      {chart && (
        <div className="mt-3 flex h-11 items-end gap-1">
          {[40, 65, 50, 80, 60, 95].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-t-[2px] rounded-b-none" style={{ height: `${h}%` }} />
          ))}
        </div>
      )}
    </>
  )
}

function CatLabel({ category, icon: Icon, label }: { category: keyof typeof CATEGORY_COLORS; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string }) {
  const cat = CATEGORY_COLORS[category]
  return (
    <div className="mb-2.5 flex items-center gap-1.5">
      <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-[5px]" style={{ background: cat.bg, color: cat.color }}>
        <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-60">{label}</span>
    </div>
  )
}
