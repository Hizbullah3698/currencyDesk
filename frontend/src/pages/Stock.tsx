import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Inbox, Printer } from 'lucide-react'
import { useStore } from '@/lib/store'
import { CURRENCIES, activeCurrencies, activityDate, currencyMeta, currencyName, openingStock, quoteRate, stk, stockTrend, stampTime, unitPkr } from '@/lib/engine'
import { fmt, fmtAmount, fmtNum, fmtQuote, fmtRate, fmtShortDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SignedAmount } from '@/components/ui/signed-amount'
import { PrintHeader } from '@/components/PrintHeader'
import { StockTrendChart } from '@/components/charts/StockTrendChart'
import { cn } from '@/lib/utils'

export function Stock() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()
  const [selected, setSelected] = useState('')

  // Currencies that actually have a position or any movement. On a brand-new desk that list is
  // empty, so fall back to the full registry rather than rendering a page with no ledger at all.
  const active = activeCurrencies(state.stocks, state.activity)
  const codes = active.length ? active : CURRENCIES
  // Derived, not stored in an effect: if the selection is no longer one of the tabs (a refetch
  // dropped it), the first tab takes over on the very same render.
  const code = codes.includes(selected) ? selected : codes[0]
  const meta = currencyMeta(code)

  const pos = stk(state.stocks, code)
  const trend = stockTrend(code, state.stocks, state.activity)

  const inCode = (t: { currency?: string }) => (t.currency || 'AED') === code
  const purchases = state.activity.filter((t) => t.type === 'purchase' && inCode(t)).slice(0, 4)
  const sales = state.activity.filter((t) => t.type === 'sale' && inCode(t)).slice(0, 4)

  const ledgerRows = buildLedger(code, state.stocks, state.activity)

  return (
    <div>
      <PrintHeader title="Currency Ledger" period={`${currencyName(code)} (${code}) desk · as of ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}.`} />

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

      {/* One tab per traded currency — everything below (KPIs, trend, recent lists, ledger)
          follows this selection. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden">
        <span className="mr-1 text-meta font-medium uppercase tracking-wide text-muted-60">Desk</span>
        {codes.map((c) => (
          <Button
            key={c}
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={c === code}
            onClick={() => setSelected(c)}
            className={cn('text-meta', c === code && 'border-accent bg-accent-bg text-accent shadow-none hover:bg-accent-bg')}
          >
            {c} · {currencyName(c)}
          </Button>
        ))}
      </div>

      <Card variant="flat" className="mb-5 grid grid-cols-[1fr_1fr_1fr_1.4fr] items-end gap-5 p-4 print:shadow-none">
        <div>
          <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">{code} available</div>
          <div className="tabular text-hero font-semibold">{fmtAmount(pos.available, code)}</div>
          <div className="mt-0.5 text-meta font-normal text-muted-60">{currencyName(code)}</div>
        </div>
        <div>
          <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">Weighted avg. cost</div>
          {/* avgCost is canonical PKR-per-unit; quoteRate() puts it back into this currency's own
              convention so an IRR cost reads as a rate a dealer recognises, not "0.000202". */}
          <div className="tabular text-body font-medium">{fmtQuote(code, pos.avgCost)}</div>
          <div className="mt-0.5 text-meta font-normal text-muted-60">{meta.rateLabel}</div>
        </div>
        <div>
          <div className="mb-1 text-meta font-medium uppercase tracking-wide text-muted-60">Inventory value</div>
          <div className="tabular text-body font-medium">{fmt(pos.available * pos.avgCost)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-meta font-medium uppercase tracking-wide text-muted-60">Stock movement</div>
          <StockTrendChart data={trend} seriesLabel={`${code} on hand`} formatValue={(v) => fmtNum(v)} height={52} showAxis />
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-5 print:hidden">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-[13px] py-2.5 text-body font-semibold">Recent {code} purchases</div>
          {purchases.map((r) => (
            <div key={r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-semibold">{r.customerName}</div>
                <div className="text-meta font-normal text-muted-60">{fmtShortDate(activityDate(r))}</div>
              </div>
              <div className="tabular text-meta font-normal text-muted-60">@ {fmtRate(r.rate || 0, code)}</div>
              {/* The dealt currency leads, the rupee conversion follows. This page names its
                  currency in the header, so the row was less misleading than a customer record —
                  but it was still the converted figure carrying the visual weight. */}
              <div className="min-w-[110px] text-right">
                <div className="tabular text-body font-medium">
                  {fmtAmount(r.amount || 0, code)} {code}
                </div>
                <div className="tabular text-meta font-normal text-muted-60">{fmt(r.pkrValue)}</div>
              </div>
            </div>
          ))}
          {purchases.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-5 text-center">
              <Inbox size={16} strokeWidth={1.8} className="text-muted-42" aria-hidden="true" />
              <div className="text-body font-normal text-muted-60">No {code} purchases yet.</div>
            </div>
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-border px-[13px] py-2.5 text-body font-semibold">Recent {code} sales</div>
          {sales.map((r) => (
            <div key={r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2 border-b border-divider px-[13px] py-2 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-semibold">{r.customerName}</div>
                <div className="text-meta font-normal text-muted-60">{fmtShortDate(activityDate(r))}</div>
              </div>
              <div className="tabular text-meta font-normal text-muted-60">@ {fmtRate(r.rate || 0, code)}</div>
              {/* The dealt currency leads, the rupee conversion follows. This page names its
                  currency in the header, so the row was less misleading than a customer record —
                  but it was still the converted figure carrying the visual weight. */}
              <div className="min-w-[110px] text-right">
                <div className="tabular text-body font-medium">
                  {fmtAmount(r.amount || 0, code)} {code}
                </div>
                <div className="tabular text-meta font-normal text-muted-60">{fmt(r.pkrValue)}</div>
              </div>
            </div>
          ))}
          {sales.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-5 text-center">
              <Inbox size={16} strokeWidth={1.8} className="text-muted-42" aria-hidden="true" />
              <div className="text-body font-normal text-muted-60">No {code} sales yet.</div>
            </div>
          )}
        </Card>
      </div>

      <Card className="mb-5 overflow-hidden print:shadow-none">
        <div className="border-b border-border px-[13px] py-2.5 text-body font-semibold">Currency stock — all desks</div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[170px]">Currency</div>
          <div className="flex-1 text-right">Quantity on hand</div>
          <div className="min-w-[190px] text-right">Weighted avg cost</div>
          <div className="min-w-[150px] text-right">Inventory value (PKR)</div>
        </div>
        {codes.map((c) => {
          const s = stk(state.stocks, c)
          return (
            <div key={c} onClick={() => setSelected(c)} className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-[13px] py-2.5 transition-colors duration-150 hover:bg-surface-hover">
              <div className="min-w-[170px]">
                <div className="text-body font-semibold">{c}</div>
                <div className="text-meta font-normal text-muted-60">{currencyName(c)}</div>
              </div>
              <div className="tabular flex-1 text-right text-body font-normal">{fmtAmount(s.available, c)}</div>
              <div className="min-w-[190px] text-right">
                <div className="tabular text-body font-normal">{fmtQuote(c, s.avgCost)}</div>
                <div className="text-meta font-normal text-muted-60">{currencyMeta(c).rateLabel}</div>
              </div>
              <div className="tabular min-w-[150px] text-right text-body font-semibold">{fmt(s.available * s.avgCost)}</div>
            </div>
          )
        })}
        <div className="flex items-center gap-2.5 border-t border-border bg-surface-hover px-[13px] py-2.5">
          <div className="flex-1 text-body font-semibold">Total inventory value</div>
          <div className="tabular min-w-[150px] text-right text-body font-bold">{fmt(codes.reduce((s, c) => s + stk(state.stocks, c).available * stk(state.stocks, c).avgCost, 0))}</div>
        </div>
        <div className="px-[13px] py-2 text-meta font-normal text-muted-60">
          Each row is carried separately on the Balance Sheet as its own Currency stock account, at its own weighted-average cost. Inventory value is always PKR, so the column totals honestly; the
          cost column is in each currency's own quote convention and is never summed.
        </div>
      </Card>

      {!isAdmin ? (
        <Card variant="flat" className="p-[18px] text-body print:shadow-none">
          <div className="mb-0.5 font-semibold">Currency ledger — Admin access required</div>
          <div className="max-w-[520px] text-meta font-normal leading-[1.5] text-muted-60">Movement-by-movement cost history is restricted to Admin. Buying and selling currency stays open to you.</div>
        </Card>
      ) : (
        <Card className="overflow-hidden print:shadow-none">
          <div className="border-b border-border px-[13px] py-2.5">
            <div className="text-body font-semibold">
              {currencyName(code)} ({code}) ledger
            </div>
            <div className="mt-0.5 text-meta font-normal leading-[1.5] text-muted-60">
              Every movement in and out of {code} stock — purchases re-weight the average cost, sales draw down at it and realise a margin. Rates and the running average cost are both shown as{' '}
              <b className="font-semibold">{meta.rateLabel}</b>.
            </div>
          </div>
          <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-meta font-semibold uppercase tracking-wide text-muted-60">
            <div className="min-w-[140px]">Movement</div>
            <div className="min-w-[70px]">Date</div>
            <div className="min-w-[100px] text-right">Quantity</div>
            <div className="min-w-[96px] text-right">Rate</div>
            <div className="min-w-[118px] text-right">Margin</div>
            <div className="flex-1 text-right">Running qty</div>
            <div className="min-w-[120px] text-right">Running avg cost</div>
          </div>
          {ledgerRows.map((row, i) => (
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
                  empty rather than printing a misleading zero. */}
              <div className="flex min-w-[118px] justify-end">
                {row.margin === null ? <span className="text-meta font-normal text-muted-42">—</span> : <SignedAmount value={row.margin} />}
              </div>
              <div className="tabular flex-1 text-right text-body font-normal">{fmtAmount(row.runQty, code)}</div>
              <div className="tabular min-w-[120px] text-right text-body font-semibold">{fmtQuote(code, row.runAvg)}</div>
            </div>
          ))}
          <div className="px-[13px] py-2 text-meta font-normal leading-[1.5] text-muted-70">
            {ledgerRows.length ? `${ledgerRows.length} ${code} movement${ledgerRows.length === 1 ? '' : 's'} shown, most recent first.` : `No ${code} movements yet.`}
          </div>
        </Card>
      )}
    </div>
  )
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

function buildLedger(code: string, stocks: import('@/lib/types').Stocks, activity: import('@/lib/types').Activity[]): LedgerRow[] {
  const open = openingStock(code, stocks, activity)
  let qty = open.qty
  let avg = open.avg
  return (
    open.moves
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
          margin: t.type === 'sale' ? t.margin || 0 : null,
          runQty: qty,
          runAvg: avg,
        }
      })
      .reverse()
  )
}
