import { useMemo } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, ArrowDownCircle, ArrowUpCircle, Wallet, Coins, Inbox, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { useStore } from '@/lib/store'
import { activeCurrencies, activityDate, isToday, stk, stockAsOf, txnIsOpen } from '@/lib/engine'
import { fmt, fmtAmount, fmtQuote, fmtShortDate, txnAmountParts } from '@/lib/format'
import { ACTIVITY_META, statusMeta, CATEGORY_COLORS } from '@/lib/ui-helpers'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { useBootReady } from '@/lib/useBootReady'
import { useCountUp } from '@/lib/useCountUp'
import { cn } from '@/lib/utils'

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

  // Same rule TopBar's own strip uses, and for the identical reason: archived customers still
  // owe/are owed real money, and a total that quietly dropped them would understate the desk's
  // actual position. Duplicated here (not imported) because it is a small, page-local derivation,
  // the same way Dashboard already computes its own stats above rather than importing them.
  const owed = useMemo(() => {
    const customers = state.accounts.filter((a) => a.type === 'Customer')
    return {
      receivable: customers.reduce((s, c) => s + (c.receivable || 0), 0),
      receivableCount: customers.filter((c) => (c.receivable || 0) > 0).length,
      payable: customers.reduce((s, c) => s + (c.payable || 0), 0),
      payableCount: customers.filter((c) => (c.payable || 0) > 0).length,
    }
  }, [state.accounts])

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
      <div className="mb-[26px]">
        <h1 className="m-0 mb-[3px] text-heading font-semibold tracking-tight">Dashboard</h1>
        <div className="text-body font-normal text-muted-70">Trading day {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      </div>

      {/* Owed to you / You owe, promoted to the same visual weight as the operational stats below
          — for this business, standing receivables/payables are more decision-relevant day to day
          than today's transaction count, so they lead rather than sitting in the thin strip above
          the title (that strip stays — it's global chrome other pages rely on too, and drilling
          into it is still how you reach a filtered customer list; this is the Dashboard's own
          prominent read of the same real numbers, not a replacement for it). Same totals rule as
          TopBar's strip: archived customers are still owed/owe real money and stay counted. */}
      <div className="mb-5 grid grid-cols-2 gap-5">
        {!ready ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatCard
              icon={ArrowDownCircle}
              iconTone="positive"
              label="Owed to you"
              value={fmt(owed.receivable)}
              valueClassName="text-positive-text"
              caption={`${owed.receivableCount} customers`}
              onClick={() => navigate('/customers?owe=receivable')}
            />
            <StatCard
              icon={ArrowUpCircle}
              iconTone="negative"
              label="You owe"
              value={fmt(owed.payable)}
              valueClassName="text-negative-text"
              caption={`${owed.payableCount} customers`}
              onClick={() => navigate('/customers?owe=payable')}
            />
          </>
        )}
      </div>

      {/* Sales/Purchases/Net cash: neutral card surfaces now, matching the rest of the dashboard's
          dark-surface style, with a small colored icon chip for identity instead of a full-card
          solid fill. The old whole-card color made "Net cash movement" read as an alarm regardless
          of whether the number was routine — color now lives on the figure itself, and only where
          the sign is actually meaningful (Sales/Purchases are magnitudes with nothing to sign; Net
          cash genuinely can land on either side of zero, so only it is sign-colored). KpiCard's
          bold solid-fill treatment is untouched — it's still right for Salary/Cheques/CustomerDetail,
          which weren't part of this request. */}
      <div className="mb-[34px] grid grid-cols-3 gap-5">
        {!ready ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={ArrowUpFromLine} iconTone="inflow" label="Sales today" value={fmt(stats.salesValue)} caption={`${stats.salesCount} sales booked`} />
            <StatCard icon={ArrowDownToLine} iconTone="outflow" label="Purchases today" value={fmt(stats.purchasesValue)} caption="Cost of currency taken in today" />
            <StatCard
              icon={Wallet}
              iconTone="accent"
              label="Net cash movement"
              value={
                <span className={cn('flex items-center gap-2', stats.net >= 0 ? 'text-positive-text' : 'text-negative-text')}>
                  {stats.net >= 0 ? <TrendingUp size={26} strokeWidth={2.2} aria-hidden="true" /> : <TrendingDown size={26} strokeWidth={2.2} aria-hidden="true" />}
                  {stats.net >= 0 ? '+' : '−'}
                  {/* Magnitude counts up once on first load; the sign and icon above stay
                      driven by the real value so direction never flickers mid-count. */}
                  {fmt(netCountUp)}
                </span>
              }
              caption={
                <span className="tabular">
                  In {fmt(stats.inflow)} · out {fmt(stats.outflow)}
                </span>
              }
            />
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
              // txnIsOpen already returns the right answer for every activity type, not just
              // sale/purchase (a receive/pay row has no outstanding balance, so it reads Settled) —
              // the old sale/purchase-only branch is what left a completed payment hardcoded to
              // "Posted" here, one word for the same state Transactions.tsx calls "Settled".
              const statusLabel = cheque ? cheque.status : txnIsOpen(row, state.accounts) ? 'Open' : 'Settled'
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
                    <div className="text-meta font-normal text-muted-60">{fmtShortDate(activityDate(row))}</div>
                  </div>
                  <div className="min-w-[66px] flex-none">
                    <Badge variant={status.variant}>
                      <StatusIcon size={10} strokeWidth={2.4} aria-hidden="true" />
                      {statusLabel}
                    </Badge>
                  </div>
                  {/* The dealt currency leads here too. This list mixes currencies, so a column of
                      bare rupee figures gave no way to tell an AED deal from a USD one. */}
                  <div className="min-w-[104px] flex-none text-right">
                    <div className="tabular text-body font-medium">{txnAmountParts(row).primary}</div>
                    {txnAmountParts(row).secondary && (
                      <div className="tabular text-meta font-normal text-muted-60">{txnAmountParts(row).secondary}</div>
                    )}
                  </div>
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

          {/* True actions only — each row opens a form to DO something. "Customers"/"Cheques"
              below aren't actions, they're navigation to a list, so they moved out to their own
              card: the two were presented identically here before, which blurred a real
              difference (this row starts a transaction; that one is just a shortcut). Buy/Sell
              Currency moved in from the page header, which duplicated the sidebar's own Currency
              Purchase/Currency Sale entries for the same action — one place to start a new
              transaction now, not two. */}
          <Card variant="flat" className="overflow-hidden">
            <div className="border-b border-divider px-3.5 py-3 text-body font-semibold tracking-tight">Quick actions</div>
            <ActionList
              items={[
                { label: 'Receive Payment', to: '/receive' },
                { label: 'Make Payment', to: '/pay' },
                { label: 'Buy Currency', to: '/purchase' },
                { label: 'Sell Currency', to: '/sale' },
              ]}
              onNavigate={navigate}
            />
          </Card>

          {/* Navigation shortcuts, visually distinct from the actions above — same list shape but
              its own card and heading, so "opens a form" and "goes to a list" don't read as the
              same kind of row. */}
          <Card variant="flat" className="overflow-hidden">
            <div className="border-b border-divider px-3.5 py-3 text-body font-semibold tracking-tight">Shortcuts</div>
            <ActionList
              items={[
                { label: 'Customers', to: '/customers' },
                { label: 'Cheques', to: '/cheques' },
              ]}
              onNavigate={navigate}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}

// Icon-chip tint pairs for StatCard — the same semantic tones KpiCard's whole-card fill used to
// carry (see kpi-card.tsx's own tone comment), just applied to a small chip instead of the full
// card now. `accent` is Net Cash Movement's chip specifically: the card/icon stay neutral no
// matter which way the number leans, since only the figure itself is meant to carry the sign.
const STAT_TONE = {
  inflow: { bg: 'var(--color-inflow-bg)', color: 'var(--color-inflow)' },
  outflow: { bg: 'var(--color-outflow-bg)', color: 'var(--color-outflow)' },
  positive: { bg: 'var(--color-positive-bg)', color: 'var(--color-positive)' },
  negative: { bg: 'var(--color-negative-bg)', color: 'var(--color-negative)' },
  accent: { bg: 'var(--color-accent-bg)', color: 'var(--color-accent)' },
} as const

/**
 * Neutral-surface stat card — Dashboard's own headline figures (Owed to you/You owe, Sales/
 * Purchases/Net cash), deliberately NOT KpiCard: that component's whole point is a bold solid-fill
 * card, which is exactly what made every one of these read as a colored alarm regardless of
 * whether the number was routine. Same footprint as KpiCard's `lg` size (identical padding/icon
 * sizing, see StatTileSkeleton below) so the two read as one consistent row size — just a plain
 * `Card` background with a small tinted icon chip for identity, and color reserved for `value`
 * itself where the caller has a real signed figure to show.
 */
function StatCard({
  icon: Icon,
  iconTone,
  label,
  value,
  valueClassName,
  caption,
  onClick,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  iconTone: keyof typeof STAT_TONE
  label: string
  value: ReactNode
  valueClassName?: string
  caption?: ReactNode
  onClick?: () => void
}) {
  const tone = STAT_TONE[iconTone]
  return (
    <Card
      onClick={onClick}
      className={cn('px-6 pb-[17px] pt-[19px]', onClick && 'cursor-pointer transition-shadow duration-150 hover:shadow-sm')}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-control" style={{ background: tone.bg, color: tone.color }}>
          <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <span className="text-meta font-medium uppercase tracking-wider text-muted-60">{label}</span>
      </div>
      <div className={cn('tabular text-hero-lg font-semibold tracking-tight', valueClassName)}>{value}</div>
      {caption && <div className="mt-2 text-meta font-normal text-muted-60">{caption}</div>}
    </Card>
  )
}

/** Shared row list for the two right-column action/shortcut cards — same shape, different intent
 *  per card (see the two call sites' own comments), so the list markup itself stays one place. */
function ActionList({ items, onNavigate }: { items: { label: string; to: string }[]; onNavigate: (to: string) => void }) {
  return (
    <>
      {items.map((a, i, arr) => (
        <div
          key={a.to}
          onClick={() => onNavigate(a.to)}
          className={`flex cursor-pointer items-center justify-between px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover ${i < arr.length - 1 ? 'border-b border-divider' : ''}`}
        >
          <span className="text-body font-medium">{a.label}</span>
          <span className="text-muted-60" aria-hidden="true">
            →
          </span>
        </div>
      ))}
    </>
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
