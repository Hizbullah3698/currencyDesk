import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Wallet, Coins, Inbox, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { useStore } from '@/lib/store'
import { activeCurrencies, activityDate, isToday, stk, stockAsOf, txnIsOpen } from '@/lib/engine'
import { fmt, fmtAmount, fmtQuote, fmtShortDate } from '@/lib/format'
import { ACTIVITY_META, statusMeta, CATEGORY_COLORS } from '@/lib/ui-helpers'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { KpiCard } from '@/components/ui/kpi-card'
import { Badge } from '@/components/ui/badge'
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useBootReady } from '@/lib/useBootReady'
import { useCountUp } from '@/lib/useCountUp'

export function Dashboard() {
  const { state } = useStore()
  const navigate = useNavigate()
  const ready = useBootReady()

  // "Today" here is a REPORTING cutoff, so it is cut on the date the deal was struck
  // (activityDate) rather than the date the row happened to be keyed in.
  const stats = useMemo(() => {
    const todaySales = state.activity.filter((t) => t.type === 'sale' && isToday(activityDate(t)))
    const todayPurchases = state.activity.filter((t) => t.type === 'purchase' && isToday(activityDate(t)))
    const inflow = state.activity
      .filter((t) => isToday(activityDate(t)) && (t.type === 'sale' || t.type === 'receive') && t.method !== 'Cheque' && t.method !== 'Credit')
      .reduce((s, t) => s + (t.type === 'sale' ? t.paidNow || 0 : t.amount), 0)
    const outflow = state.activity
      .filter((t) => isToday(activityDate(t)) && (t.type === 'purchase' || t.type === 'pay') && t.method !== 'Cheque' && t.method !== 'Credit')
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
  const startOfTodayT = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])
  // One row per currency the desk actually trades — nothing here is AED-specific any more.
  const codes = useMemo(() => activeCurrencies(state.stocks, state.activity), [state.stocks, state.activity])
  const stockRows = useMemo(
    () =>
      codes.map((code) => {
        const pos = stk(state.stocks, code)
        const opening = stockAsOf(code, state.stocks, state.activity, startOfTodayT - 1).available
        return { code, available: pos.available, avgCost: pos.avgCost, delta: pos.available - opening }
      }),
    [codes, state.stocks, state.activity, startOfTodayT],
  )
  const movedToday = stockRows.filter((r) => r.delta !== 0)
  // The app's one signature motion moment — see useCountUp's own note.
  const netCountUp = useCountUp(Math.abs(stats.net))

  return (
    <div>
      <div className="mb-[26px] flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 mb-[3px] text-heading font-semibold tracking-tight">Dashboard</h1>
          <div className="text-body font-normal text-muted-70">Trading day {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
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
            <KpiCard tone="inflow" icon={ArrowUpFromLine} label="Sales today" caption={`${stats.salesCount} sales booked`}>
              <div className="tabular text-hero-lg font-semibold tracking-tight text-white">{fmt(stats.salesValue)}</div>
            </KpiCard>
            <KpiCard tone="outflow" icon={ArrowDownToLine} label="Purchases today" caption="Cost of currency taken in today">
              <div className="tabular text-hero-lg font-semibold tracking-tight text-white">{fmt(stats.purchasesValue)}</div>
            </KpiCard>
            <KpiCard
              tone={stats.net >= 0 ? 'positive' : 'negative'}
              icon={Wallet}
              label="Net cash movement"
              caption={
                <span className="tabular">
                  In {fmt(stats.inflow)} · out {fmt(stats.outflow)}
                </span>
              }
            >
              <div className="tabular flex items-center gap-2 text-hero-lg font-semibold tracking-tight text-white">
                {stats.net >= 0 ? <TrendingUp size={26} strokeWidth={2.2} aria-hidden="true" /> : <TrendingDown size={26} strokeWidth={2.2} aria-hidden="true" />}
                {stats.net >= 0 ? '+' : '−'}
                {/* Magnitude counts up once on first load; the sign and icon above stay
                    driven by the real value so direction never flickers mid-count. */}
                {fmt(netCountUp)}
              </div>
            </KpiCard>
          </>
        )}
      </div>

      <div className="grid grid-cols-[1.65fr_1fr] items-start gap-5">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-[13px] py-2.5">
            <div className="text-body font-semibold tracking-tight">Recent activity</div>
            <button onClick={() => navigate('/transactions')} className="cursor-pointer text-meta font-medium text-accent transition-colors duration-150 hover:text-accent-hover">
              All transactions →
            </button>
          </div>
          <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-1.5 text-meta font-semibold uppercase tracking-wide text-muted-60">
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
              const statusLabel = cheque ? cheque.status : row.type === 'sale' || row.type === 'purchase' ? (txnIsOpen(row, state.accounts) ? 'Open' : 'Settled') : 'Posted'
              const status = statusMeta(statusLabel)
              const StatusIcon = status.icon
              return (
                <div key={row.id} onClick={() => row.customerId && navigate(`/customers/${row.customerId}`)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
                  <div className="flex h-5 w-5 flex-none items-center justify-center rounded-data" style={{ background: meta.chipBg, color: meta.chipColor }}>
                    <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                  </div>
                  <div className="w-[88px] flex-none text-body font-medium text-ink">{meta.label}</div>
                  <div className="min-w-[66px] flex-1 overflow-hidden">
                    <div className="truncate text-body font-semibold">{row.customerName}</div>
                    <div className="text-meta font-normal text-muted-60">
                      {row.type === 'purchase' || row.type === 'sale' ? `${fmtAmount(row.amount || 0, row.currency || 'AED')} ${row.currency || 'AED'} · ` : ''}
                      {fmtShortDate(activityDate(row))}
                    </div>
                  </div>
                  <div className="min-w-[66px] flex-none">
                    <Badge variant={status.variant}>
                      <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="tabular min-w-[92px] flex-none text-right text-body font-medium">{fmt(row.pkrValue)}</div>
                </div>
              )
            })
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card variant="flat" onClick={() => navigate('/cheques')} className="cursor-pointer p-[13px] transition-[box-shadow,background-color] duration-150 hover:bg-surface-hover hover:shadow-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-body font-semibold tracking-tight">Uncleared cheques</div>
              <span className="text-meta font-medium text-accent">Cheques →</span>
            </div>
            {!ready ? (
              <SideCardSkeleton />
            ) : (
              <>
                <div className="tabular text-heading font-semibold tracking-tight">{fmt(unclearedIn + unclearedOut)}</div>
                <div className="mt-0.5 text-meta font-normal text-muted-60">{uncleared.length} not yet cleared — no balance moved</div>
                <div className="mt-2.5 flex gap-4 border-t border-divider pt-2">
                  <div>
                    <div className="text-meta font-medium uppercase tracking-wide text-muted-60">Inward</div>
                    <div className="tabular text-body font-medium text-positive">{fmt(unclearedIn)}</div>
                  </div>
                  <div>
                    <div className="text-meta font-medium uppercase tracking-wide text-muted-60">Outward</div>
                    <div className="tabular text-body font-medium text-muted-70">{fmt(unclearedOut)}</div>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card variant="flat" className="p-[13px]">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-data" style={{ background: CATEGORY_COLORS.fx.bg, color: CATEGORY_COLORS.fx.color }}>
                  <Coins size={11} strokeWidth={2.2} aria-hidden="true" />
                </span>
                <span className="text-body font-semibold tracking-tight">Currency stock</span>
              </div>
              <button onClick={() => navigate('/stock')} className="cursor-pointer text-meta font-medium text-accent transition-colors duration-150 hover:text-accent-hover">
                Details →
              </button>
            </div>
            {!ready ? (
              <SideCardSkeleton delta />
            ) : (
              <>
                {stockRows.length === 0 ? (
                  <div className="text-body font-normal text-muted-60">No currency positions yet.</div>
                ) : (
                  stockRows.map((r, i) => (
                    <div key={r.code} className={`flex items-baseline justify-between gap-2 py-1.5 ${i > 0 ? 'border-t border-divider' : ''}`}>
                      <div>
                        <div className="text-body font-semibold">{r.code}</div>
                        {/* Avg cost is stored canonically as PKR-per-unit; fmtQuote puts it back
                            into this currency's own convention (IRR per 1 PKR for IRR). */}
                        <div className="text-meta font-normal text-muted-60">@ {fmtQuote(r.code, r.avgCost)}</div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-body font-semibold">{fmtAmount(r.available, r.code)}</div>
                        <div className="tabular text-meta font-normal text-muted-60">{fmt(r.available * r.avgCost)}</div>
                      </div>
                    </div>
                  ))
                )}
                <div className="mt-3 flex flex-col gap-1 rounded-control bg-surface-sunken px-2.5 py-2 text-meta font-normal text-muted-70">
                  {movedToday.length === 0 ? (
                    <div className="flex items-center gap-1.5">
                      <Minus size={12} strokeWidth={2.4} className="flex-none text-muted-42" aria-hidden="true" />
                      No change in stock today
                    </div>
                  ) : (
                    movedToday.map((r) => (
                      <div key={r.code} className="flex items-center gap-1.5">
                        {r.delta > 0 ? (
                          <ArrowUp size={12} strokeWidth={2.6} className="flex-none text-accent" aria-hidden="true" />
                        ) : (
                          <ArrowDown size={12} strokeWidth={2.6} className="flex-none text-accent" aria-hidden="true" />
                        )}
                        <span className="tabular font-semibold text-ink">
                          {r.delta > 0 ? '+' : '−'}
                          {fmtAmount(Math.abs(r.delta), r.code)} {r.code}
                        </span>
                        {r.delta > 0 ? 'purchased today' : 'sold today'}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </Card>

          <Card variant="flat" className="overflow-hidden">
            <div className="border-b border-divider px-3.5 py-3 text-body font-semibold tracking-tight">Quick actions</div>
            {[
              { label: 'Receive Payment', to: '/receive' },
              { label: 'Make Payment', to: '/pay' },
              { label: 'Customers', to: '/customers' },
              { label: 'Cheques', to: '/cheques' },
            ].map((a, i, arr) => (
              <div key={a.to} onClick={() => navigate(a.to)} className={`flex cursor-pointer items-center justify-between px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover ${i < arr.length - 1 ? 'border-b border-divider' : ''}`}>
                <span className="text-body font-medium">{a.label}</span>
                <span className="text-muted-60" aria-hidden="true">→</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}

// Padding/margins mirror KpiCard's `lg` size exactly, so the tiles don't change
// height when real data replaces the skeleton.
function StatTileSkeleton() {
  return (
    <Card variant="flat" className="border border-border px-6 pb-[17px] pt-[19px] shadow-md">
      <div className="mb-2 flex items-center gap-1.5">
        <Skeleton className="h-6 w-6 rounded-control" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <Skeleton className="h-9 w-36" />
      <Skeleton className="mt-2 h-2.5 w-28" />
    </Card>
  )
}

function SideCardSkeleton({ delta }: { delta?: boolean }) {
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
      {delta && <Skeleton className="mt-3 h-8 w-full rounded-control" />}
    </>
  )
}
