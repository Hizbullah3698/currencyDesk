import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Printer } from 'lucide-react'
import { useStore } from '@/lib/store'
import { CURRENCIES, activeCurrencies, activityDate, currencyMeta, currencyName, openingStock, quoteRate, stk, stampTime, unitPkr } from '@/lib/engine'
import { fmt, fmtAmount, fmtCompact, fmtQuote, fmtRate, fmtShortDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InfoHint } from '@/components/ui/info-hint'
import { SignedAmount } from '@/components/ui/signed-amount'
import { PrintHeader } from '@/components/PrintHeader'
import { StockPositionChart, type PositionPoint } from '@/components/charts/StockPositionChart'
import { cn } from '@/lib/utils'

/** How many movements the position chart shows. Older ones are still in the ledger below it. */
const CHART_MOVEMENTS = 24

// ---------------------------------------------------------------------------
// NAMING THE SELECTED CURRENCY — once, and only once
// ---------------------------------------------------------------------------
// This page used to say "Euro" four times on one screen: in the tab (`EUR · Euro`), in the hero
// ("EUR available", captioned "Euro"), in the all-currencies row, and again in a section heading
// ("Euro (EUR) ledger"). The rule now: the hero states the full name once, prominently, and
// everything downstream of it uses the three-letter code alone — which is what a dealer scans by,
// and the same call the trade screen's currency combobox already makes (code collapsed, name only
// in the open list). The all-currencies table is the one exception, and only for the rows that are
// NOT selected: there the name is not a repetition, it is the sole place those codes are spelled.
// ---------------------------------------------------------------------------

export function Stock() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()
  // The initial selection can be handed in as ?code=USD, so a Currency Stock account row on the
  // Accounts page can open THIS page on that currency instead of the edit form — which showed a
  // name and a currency picker and then said the quantity and cost "come from the currency
  // ledger", without showing either. Read once as the initial value rather than kept in the URL:
  // the tabs below are a local browsing gesture, not navigation, and writing every tab click into
  // history would put a dozen entries between the user and the Back button.
  const [params] = useSearchParams()
  const [selected, setSelected] = useState(() => (params.get('code') || '').toUpperCase())

  // Currencies that actually have a position or any movement. On a brand-new desk that list is
  // empty, so fall back to the full registry rather than rendering a page with no ledger at all.
  const active = activeCurrencies(state.stocks, state.activity)
  const codes = active.length ? active : CURRENCIES
  // Derived, not stored in an effect: if the selection is no longer one of the tabs (a refetch
  // dropped it), the first tab takes over on the very same render.
  const code = codes.includes(selected) ? selected : codes[0]
  const meta = currencyMeta(code)

  const pos = stk(state.stocks, code)
  const ledger = buildLedger(code, state.stocks, state.activity)

  // The chart reads the ledger replay rather than recomputing the position from activity: two
  // walks over the same movements are two chances to disagree about the same figure.
  const chartPoints = positionSeries(ledger)

  const totalValue = codes.reduce((s, c) => {
    const p = stk(state.stocks, c)
    return s + p.available * p.avgCost
  }, 0)

  return (
    <div>
      <PrintHeader title="Currency Ledger" period={`${currencyName(code)} (${code}) · as of ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}.`} />

      <div className="mb-[26px] flex items-center justify-between gap-2.5 print:hidden">
        <h1 className="m-0 text-heading font-semibold">Currency Stock</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} strokeWidth={2} aria-hidden="true" />
            Print
          </Button>
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

      {/* Codes alone, and no "Desk" caption over them: the app has no other notion of a desk, so
          the word explained nothing, and a row of three-letter currency codes needs no label. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden">
        {codes.map((c) => (
          <Button
            key={c}
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={c === code}
            aria-label={`${c} — ${currencyName(c)}`}
            onClick={() => setSelected(c)}
            className={cn('tabular text-meta', c === code && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
          >
            {c}
          </Button>
        ))}
      </div>

      {/* HERO — the one place the selected currency is named, and the primary read of the page. */}
      <Card variant="flat" className="mb-5 p-4 print:shadow-none">
        <div className="mb-3.5 flex items-baseline gap-2">
          <h2 className="m-0 text-heading font-semibold tracking-tight">{currencyName(code)}</h2>
          <span className="tabular rounded-data bg-surface-tint px-1.5 py-0.5 text-meta font-semibold text-muted-70">{code}</span>
        </div>
        {/* Capped, not stretched: three figures spread across a 1,100px row stop reading as one
            group, and the gaps between them start to look like missing columns. */}
        <div className="grid max-w-[680px] grid-cols-[1.2fr_1fr_1fr] items-end gap-6">
          <div>
            <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">Available</div>
            <div className="tabular text-hero font-semibold tracking-tight">
              {fmtAmount(pos.available, code)}
              <span className="ml-1.5 text-body font-medium text-muted-60">{code}</span>
            </div>
          </div>
          <div>
            <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">Weighted avg. cost</div>
            {/* avgCost is canonical PKR-per-unit; fmtQuote puts it back into this currency's own
                convention so an IRR cost reads as a rate a dealer recognises, not "0.000202". The
                caption under it is the number's UNIT, not an explanation — it stays visible. */}
            <div className="tabular text-body font-medium">{fmtQuote(code, pos.avgCost)}</div>
            <div className="mt-0.5 text-meta font-normal text-muted-60">{meta.rateLabel}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-meta font-medium uppercase tracking-wide text-muted-60">
              Inventory value
              <InfoHint text={`Quantity on hand valued at the weighted-average cost the desk actually paid, never at today's market rate. This is the figure carried on the Balance Sheet as the ${code} Currency stock account.`} />
            </div>
            <div className="tabular text-body font-medium">{fmt(pos.available * pos.avgCost)}</div>
          </div>
        </div>
      </Card>

      {/* One real chart or none. An empty desk renders nothing here — no frame, no placeholder. */}
      {chartPoints.length > 1 && (
        <Card className="mb-5 overflow-hidden print:hidden">
          <div className="flex items-center justify-between gap-2.5 border-b border-border px-[13px] py-2.5">
            <div>
              <div className="text-body font-semibold">Position after each movement</div>
              <div className="mt-0.5 text-meta font-normal text-muted-60">
                Quantity on hand, in {code} ·{' '}
                {ledger.rows.length > CHART_MOVEMENTS ? `last ${CHART_MOVEMENTS} of ${ledger.rows.length} movements` : `${ledger.rows.length} movement${ledger.rows.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <InfoHint text="Movements run in the order they were posted, which is the order the weighted-average cost was built in. A backdated deal therefore appears where it sits in the cost history, not where its date would fall on a calendar." />
          </div>
          <div className="px-2 py-3">
            <StockPositionChart data={chartPoints} code={code} formatQty={(n) => fmtAmount(n, code)} formatTick={fmtCompact} />
          </div>
        </Card>
      )}

      {/* THE transaction history for this currency — there is no second "recent activity" preview
          above it any more. Two panels showing the newest four purchases and the newest four sales
          were a strict subset of these same rows, three sections further down the page.
          Non-admins get the same table minus the two cost columns (see the header below). */}
      <Card className="mb-5 overflow-hidden print:shadow-none">
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-[13px] py-2.5">
          <div>
            <div className="text-body font-semibold">{code} movements</div>
            <div className="mt-0.5 text-meta font-normal text-muted-60">
              {ledger.rows.length ? `${ledger.rows.length} movement${ledger.rows.length === 1 ? '' : 's'}, most recent first` : 'Nothing bought or sold yet'} · rates as {meta.rateLabel}
            </div>
          </div>
          <InfoHint
            text={
              isAdmin
                ? 'Every movement in and out of stock. A purchase re-weights the average cost; a sale draws down at it and realises the margin shown.'
                : 'Every movement in and out of stock. Movement-by-movement cost history and realised margin are Admin-only, so those two columns are not shown.'
            }
          />
        </div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[140px]">Movement</div>
          <div className="min-w-[70px]">Date</div>
          <div className="min-w-[100px] text-right">Quantity</div>
          <div className="min-w-[96px] text-right">Rate</div>
          {isAdmin && <div className="min-w-[118px] text-right">Margin</div>}
          <div className="flex-1 text-right">Running qty</div>
          {isAdmin && <div className="min-w-[120px] text-right">Running avg cost</div>}
        </div>
        {ledger.rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
            <div className="min-w-[140px]">
              <div className="text-body font-medium">{row.type === 'purchase' ? 'Purchase' : 'Sale'}</div>
              <div className="text-meta font-normal text-muted-60">{row.who}</div>
            </div>
            <div className="min-w-[70px] text-meta font-normal text-muted-70">{fmtShortDate(row.date)}</div>
            <div className={`tabular min-w-[100px] text-right text-body font-normal ${row.type === 'purchase' ? 'text-positive' : 'text-negative'}`}>
              {row.type === 'purchase' ? '+' : '−'}
              {fmtAmount(row.amount, code)}
            </div>
            <div className="tabular min-w-[96px] text-right text-body font-normal text-muted-70">{fmtRate(row.rate, code)}</div>
            {/* Margin belongs to sales only — a purchase has none to show, so the cell stays
                empty rather than printing a misleading zero. Hidden entirely for non-admins,
                whose snapshot omits `margin` altogether: `margin || 0` would print a confident
                zero on every sale, which is exactly the claim the API refuses to make. */}
            {isAdmin && <div className="flex min-w-[118px] justify-end">{row.margin === null ? <span className="text-meta font-normal text-muted-42">—</span> : <SignedAmount value={row.margin} />}</div>}
            <div className="tabular flex-1 text-right text-body font-normal">{fmtAmount(row.runQty, code)}</div>
            {isAdmin && <div className="tabular min-w-[120px] text-right text-body font-semibold">{fmtQuote(code, row.runAvg)}</div>}
          </div>
        ))}
        {ledger.rows.length === 0 && (
          <div className="px-[13px] py-5 text-center text-body font-normal text-muted-60">
            No {code} movements yet. Buying or selling {code} writes a row here.
          </div>
        )}
      </Card>

      {/* COMPARISON, not a restatement. Quantity and inventory value only: the weighted-average
          cost column that used to sit between them is in each currency's own quote convention, so
          it never compared across rows and never summed — it is in the hero for the currency
          actually open. The selected row is marked rather than blanked, because a comparison table
          missing the one row you are looking at compares nothing. */}
      <Card className="overflow-hidden print:shadow-none">
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-[13px] py-2.5">
          <div className="text-body font-semibold">All currencies</div>
          <InfoHint text="Each currency is carried separately on the Balance Sheet as its own Currency stock account, at its own weighted-average cost. Inventory value is always PKR, so this column totals honestly." />
        </div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[150px]">Currency</div>
          <div className="flex-1 text-right">Quantity on hand</div>
          <div className="min-w-[170px] text-right">Inventory value (PKR)</div>
        </div>
        {codes.map((c) => {
          const s = stk(state.stocks, c)
          const isOpen = c === code
          return (
            <button
              key={c}
              type="button"
              onClick={() => setSelected(c)}
              aria-current={isOpen ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 border-b border-divider px-[13px] py-2.5 text-left transition-colors duration-150 hover:bg-surface-hover',
                isOpen && 'bg-accent-bg hover:bg-accent-bg',
              )}
            >
              <div className="flex min-w-[150px] items-baseline gap-1.5">
                <span className={cn('tabular text-body font-semibold', isOpen && 'text-accent')}>{c}</span>
                {/* The name only where it is not already stated above — for the open currency the
                    hero has just said it, in full, at heading size. */}
                {!isOpen && <span className="text-meta font-normal text-muted-60">{currencyName(c)}</span>}
              </div>
              <div className="tabular flex-1 text-right text-body font-normal">{fmtAmount(s.available, c)}</div>
              <div className="tabular min-w-[170px] text-right text-body font-semibold">{fmt(s.available * s.avgCost)}</div>
            </button>
          )
        })}
        <div className="flex items-center gap-2.5 border-t border-border bg-surface-hover px-[13px] py-2.5">
          <div className="flex-1 text-body font-semibold">Total inventory value</div>
          <div className="tabular min-w-[170px] text-right text-body font-bold">{fmt(totalValue)}</div>
        </div>
      </Card>
    </div>
  )
}

/**
 * The chart series: the opening position, then one point per movement in replay order.
 *
 * Truncating to the last CHART_MOVEMENTS re-bases the opening point on the position going INTO
 * that window rather than the desk's original opening balance — otherwise the first step would be
 * a fiction, jumping from a balance that predates every point drawn.
 */
function positionSeries(ledger: { rows: LedgerRow[]; openQty: number }): PositionPoint[] {
  if (!ledger.rows.length) return []
  const chrono = ledger.rows.slice().reverse()
  const start = Math.max(0, chrono.length - CHART_MOVEMENTS)
  const openQty = start === 0 ? ledger.openQty : chrono[start - 1].runQty
  const moves = chrono.slice(start).map((r): PositionPoint => ({
    label: fmtShortDate(r.date),
    qty: r.runQty,
    kind: r.type === 'purchase' ? 'purchase' : 'sale',
    who: r.who,
    delta: r.amount,
  }))
  return [
    { label: 'Opening', qty: openQty, kind: 'opening', delta: 0 },
    ...moves,
    // A trailing point at today's position. Without it the step interpolation gives the CURRENT
    // level — the one figure the page is about — a segment of zero width against the right edge,
    // so the chart appears to end on the drop into it rather than on the position it left behind.
    { label: 'Now', qty: moves[moves.length - 1].qty, kind: 'current', delta: 0 },
  ]
}

interface LedgerRow {
  type: string
  who: string
  /** Full ISO — the date the deal was struck, from activityDate(). */
  date: string
  amount: number
  /** In this currency's own quote convention, ready to print. */
  rate: number
  /** Sales only; null on a purchase, which has no margin to report. */
  margin: number | null
  runQty: number
  runAvg: number
}

/**
 * The replay behind both the movements table and the position chart.
 *
 * Returns the opening position alongside the rows because the chart needs a first point to step
 * from, and re-deriving it separately would be a second walk over the same movements.
 */
function buildLedger(
  code: string,
  stocks: import('@/lib/types').Stocks,
  activity: import('@/lib/types').Activity[],
): { rows: LedgerRow[]; openQty: number } {
  const open = openingStock(code, stocks, activity)
  let qty = open.qty
  let avg = open.avg
  const rows = open.moves
    .slice()
    // ORDERING stays on createdAt, deliberately — the stored weighted-average cost was built up
    // one posting at a time in exactly this order and openingStock() unwinds it the same way
    // (see its comment in the engine). Re-sorting by the deal date would not reproduce the
    // figure this replay starts from. Backdating moves a deal between REPORTING PERIODS, which
    // is a separate question handled by activityDate() — used below for display only.
    .sort((a, b) => stampTime(a.createdAt) - stampTime(b.createdAt))
    .map((t): LedgerRow => {
      const amt = t.amount || 0
      // unitPkr(t), NOT `amt * t.rate` — `t.rate` is in the currency's own quote convention and
      // is not a PKR figure at all for a 'divide'-quoted currency like IRR, so multiplying by
      // it here would silently corrupt the running average.
      const unit = unitPkr(t)
      if (t.type === 'purchase') {
        const nq = qty + amt
        avg = nq > 0 ? (qty * avg + amt * unit) / nq : avg
        qty = nq
      } else {
        qty -= amt
      }
      return {
        type: t.type,
        who: t.customerName,
        date: activityDate(t),
        amount: amt,
        rate: t.rate || quoteRate(code, avg),
        margin: t.type === 'sale' ? t.margin ?? null : null,
        runQty: qty,
        runAvg: avg,
      }
    })
    .reverse()
  return { rows, openQty: open.qty }
}
