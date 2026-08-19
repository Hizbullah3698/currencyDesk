import { useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { activeCurrencies, openingStock, stk, stockTrend, stampTime } from '@/lib/engine'
import { fmt, fmtNum, fmtRate } from '@/lib/format'

export function Stock() {
  const { state, isAdmin } = useStore()
  const navigate = useNavigate()

  const aed = stk(state.stocks, 'AED')
  const trend = stockTrend('AED', state.stocks, state.activity)
  const codes = activeCurrencies(state.stocks, state.activity)

  const purchases = state.activity.filter((t) => t.type === 'purchase').slice(0, 4)
  const sales = state.activity.filter((t) => t.type === 'sale').slice(0, 4)

  const ledgerRows = buildLedger('AED', state.stocks, state.activity)

  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between gap-2.5">
        <h1 className="m-0 text-[17px] font-semibold">Currency Stock</h1>
        <div className="flex gap-2">
          <button onClick={() => navigate('/purchase')} className="rounded-[6px] border border-border-input bg-surface px-3 py-[7px] text-[12.5px] font-semibold hover:bg-surface-tint">
            Buy Currency
          </button>
          <button onClick={() => navigate('/sale')} className="rounded-[6px] border border-accent bg-accent px-3 py-[7px] text-[12.5px] font-semibold text-white hover:bg-accent-hover">
            Sell Currency
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-[1fr_1fr_1fr_1.4fr] items-end gap-5 rounded-[8px] border border-border bg-surface p-4">
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">AED available</div>
          <div className="tabular text-[26px] font-medium">{fmtNum(aed.available)}</div>
        </div>
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Weighted avg. cost</div>
          <div className="tabular text-[17px] font-medium">{fmtRate(aed.avgCost)}</div>
        </div>
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Inventory value</div>
          <div className="tabular text-[17px] font-medium">{fmt(aed.available * aed.avgCost)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">Stock movement</div>
          <div className="flex h-[52px] items-end gap-1.5">
            {trend.map((bar, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
                <div className="w-full rounded-t-[2px]" style={{ background: bar.color, height: `${bar.heightPct}%`, minHeight: 3 }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
          <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Recent purchases</div>
          {purchases.map((r) => (
            <div key={r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2 border-b border-divider px-[13px] py-2 hover:bg-surface-hover">
              <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{r.customerName}</div>
              <div className="tabular text-[11.5px] text-muted-60">
                {fmtNum(r.amount || 0)} @ {fmtRate(r.rate || 0)}
              </div>
              <div className="tabular min-w-[96px] text-right text-[12.5px] font-medium">{fmt(r.pkrValue)}</div>
            </div>
          ))}
          {purchases.length === 0 && <div className="py-5 text-center text-[12px] text-muted-60">No purchases yet.</div>}
        </div>
        <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
          <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Recent sales</div>
          {sales.map((r) => (
            <div key={r.id} onClick={() => r.customerId && navigate(`/customers/${r.customerId}`)} className="flex cursor-pointer items-center gap-2 border-b border-divider px-[13px] py-2 hover:bg-surface-hover">
              <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{r.customerName}</div>
              <div className="tabular text-[11.5px] text-muted-60">
                {fmtNum(r.amount || 0)} @ {fmtRate(r.rate || 0)}
              </div>
              <div className="tabular min-w-[96px] text-right text-[12.5px] font-medium">{fmt(r.pkrValue)}</div>
            </div>
          ))}
          {sales.length === 0 && <div className="py-5 text-center text-[12px] text-muted-60">No sales yet.</div>}
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-[8px] border border-border bg-surface">
        <div className="border-b border-border px-[13px] py-2.5 text-[12.5px] font-semibold">Currency stock</div>
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
          <div className="min-w-[70px]">Currency</div>
          <div className="flex-1 text-right">Quantity on hand</div>
          <div className="min-w-[130px] text-right">Weighted avg cost</div>
          <div className="min-w-[150px] text-right">Inventory value (PKR)</div>
        </div>
        {codes.map((code) => {
          const s = stk(state.stocks, code)
          return (
            <div key={code} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2.5">
              <div className="min-w-[70px] text-[12.5px] font-semibold">{code}</div>
              <div className="tabular flex-1 text-right text-[12.5px]">{fmtNum(s.available)}</div>
              <div className="tabular min-w-[130px] text-right text-[12.5px]">{fmtRate(s.avgCost)}</div>
              <div className="tabular min-w-[150px] text-right text-[12.5px] font-semibold">{fmt(s.available * s.avgCost)}</div>
            </div>
          )
        })}
        <div className="flex items-center gap-2.5 border-t border-border bg-surface-hover px-[13px] py-2.5">
          <div className="flex-1 text-[12px] font-semibold">Total inventory value</div>
          <div className="tabular min-w-[150px] text-right text-[13px] font-bold">{fmt(codes.reduce((s, c) => s + stk(state.stocks, c).available * stk(state.stocks, c).avgCost, 0))}</div>
        </div>
        <div className="px-[13px] py-2 text-[11px] text-muted-60">Each row is carried separately on the Balance Sheet as its own Currency stock account, at its own weighted-average cost.</div>
      </div>

      {!isAdmin ? (
        <div className="rounded-[8px] border border-border bg-surface p-[18px] text-[12.5px]">
          <div className="mb-0.5 font-semibold">Currency ledger — Admin access required</div>
          <div className="max-w-[520px] text-[11.5px] leading-[1.5] text-muted-60">Movement-by-movement cost history is restricted to Admin. Buying and selling currency stays open to you.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
          <div className="border-b border-border px-[13px] py-2.5">
            <div className="text-[12.5px] font-semibold">Currency ledger</div>
            <div className="mt-0.5 text-[11px] text-muted-60">Every movement in and out of stock, oldest first — purchases re-weight the average cost, sales draw down at it.</div>
          </div>
          <div className="flex items-center gap-2.5 border-b border-border bg-surface-sunken px-[13px] py-[7px] text-[10.5px] font-semibold uppercase tracking-wide text-muted-60">
            <div className="min-w-[150px]">Movement</div>
            <div className="min-w-[110px] text-right">Quantity</div>
            <div className="min-w-[80px] text-right">Rate</div>
            <div className="flex-1 text-right">Running qty</div>
            <div className="min-w-[130px] text-right">Running avg cost</div>
          </div>
          {ledgerRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2.5 border-b border-divider px-[13px] py-2">
              <div className="min-w-[150px]">
                <div className="text-[12.5px] font-semibold">{row.type === 'purchase' ? 'Purchase' : 'Sale'}</div>
                <div className="text-[11px] text-muted-60">{row.who}</div>
              </div>
              <div className={`tabular min-w-[110px] text-right text-[12.5px] ${row.type === 'purchase' ? 'text-positive' : 'text-negative'}`}>
                {row.type === 'purchase' ? '+' : '−'}
                {fmtNum(row.amount)}
              </div>
              <div className="tabular min-w-[80px] text-right text-[12px] text-muted-70">{fmtRate(row.rate)}</div>
              <div className="tabular flex-1 text-right text-[12.5px]">{fmtNum(row.runQty)}</div>
              <div className="tabular min-w-[130px] text-right text-[12.5px] font-semibold">{fmtRate(row.runAvg)}</div>
            </div>
          ))}
          <div className="px-[13px] py-2 text-[11.5px] leading-[1.5] text-muted-70">
            {ledgerRows.length ? `${ledgerRows.length} movement${ledgerRows.length === 1 ? '' : 's'} shown, oldest first.` : 'No currency movements yet.'}
          </div>
        </div>
      )}
    </div>
  )
}

function buildLedger(code: string, stocks: import('@/lib/types').Stocks, activity: import('@/lib/types').Activity[]) {
  const open = openingStock(code, stocks, activity)
  let qty = open.qty
  let avg = open.avg
  return open.moves
    .slice()
    .sort((a, b) => stampTime(a.createdAt) - stampTime(b.createdAt))
    .map((t) => {
      const amt = t.amount || 0
      if (t.type === 'purchase') {
        const nq = qty + amt
        avg = nq > 0 ? (qty * avg + amt * (t.rate || 0)) / nq : avg
        qty = nq
      } else {
        qty -= amt
      }
      return { type: t.type, who: t.customerName, amount: amt, rate: t.rate || avg, runQty: qty, runAvg: avg }
    })
    .reverse()
}
