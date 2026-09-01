import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface PositionPoint {
  /** X-axis category: a short date, "Opening" for the balance the replay starts from, or "Now". */
  label: string
  /** Quantity on hand after this movement, in the currency's own units. */
  qty: number
  kind: 'opening' | 'purchase' | 'sale' | 'current'
  who?: string
  /** Size of the movement itself, for the tooltip. Zero on the opening and current points. */
  delta: number
}

/**
 * Quantity on hand after each movement, for one currency.
 *
 * This replaces a six-bar sparkline that was chart-shaped and nothing else: evenly shaded bars with
 * no axis, no units and a height floored at 10% so an empty desk still drew a full row of bars — it
 * read as data while asserting nothing. What makes this one a chart rather than decoration is that
 * every part of it is legible without hovering: a labelled Y scale in the currency's own units, a
 * dated X axis, a zero line, and a step interpolation that tells the truth about how a stock level
 * actually behaves (flat between movements, a jump at each one — never a smooth diagonal).
 *
 * X is CATEGORICAL, not a time scale, and deliberately so: the series is the ledger replay, which
 * runs in posting order (`createdAt`) because that is the order the weighted-average cost was built
 * in. A backdated deal therefore shows an out-of-order date label, which is honest — it is where
 * that deal sits in the cost history. Spacing points by calendar date would imply the replay ran in
 * that order, which it did not. See buildLedger() in pages/Stock.tsx.
 *
 * Rendered only when there is at least one movement — an empty desk gets no chart at all rather
 * than an empty frame.
 */
export function StockPositionChart({
  data,
  code,
  formatQty,
  formatTick,
  height = 210,
}: {
  data: PositionPoint[]
  code: string
  /** Full-precision quantity for the tooltip. */
  formatQty: (n: number) => string
  /** Short quantity for the axis ticks. */
  formatTick: (n: number) => string
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="stock-position-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-divider)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10.5, fill: 'var(--color-muted-60)' }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
          minTickGap={14}
          height={20}
        />
        <YAxis
          width={62}
          tickFormatter={formatTick}
          tick={{ fontSize: 10.5, fill: 'var(--color-muted-60)' }}
          tickLine={false}
          axisLine={false}
          // A stock level is read against zero — an auto-scaled floor would make a position that
          // never went near zero look like it nearly ran out.
          domain={[0, 'auto']}
        />
        <ReferenceLine y={0} stroke="var(--color-border-strong)" />
        <Tooltip
          cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '3 3' }}
          contentStyle={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 11.5,
            padding: '6px 9px',
            boxShadow: 'var(--shadow-md)',
          }}
          labelStyle={{ color: 'var(--color-muted-60)', fontSize: 10.5, marginBottom: 2 }}
          separator=" "
          // What MOVED goes on the muted label line with the date; what is left ON HAND is the
          // value. Both on one line read as one figure divided by a colon, which they are not.
          labelFormatter={(label: unknown, payload: unknown) => {
            const p = (payload as { payload?: PositionPoint }[] | undefined)?.[0]?.payload
            if (!p) return String(label ?? '')
            if (p.kind === 'opening') return 'Opening balance'
            if (p.kind === 'current') return 'Position now'
            return `${label} · ${p.kind === 'purchase' ? '+' : '−'}${formatQty(Math.abs(p.delta))}${p.who ? ` · ${p.who}` : ''}`
          }}
          formatter={(_v: unknown, _n: unknown, item: unknown) => {
            const p = (item as { payload?: PositionPoint })?.payload
            return [`${formatQty(p?.qty ?? 0)} ${code}`, 'On hand'] as [string, string]
          }}
        />
        <Area
          type="stepAfter"
          dataKey="qty"
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="url(#stock-position-fill)"
          isAnimationActive={false}
          dot={{ r: 2, fill: 'var(--color-accent)', strokeWidth: 0 }}
          activeDot={{ r: 4, fill: 'var(--color-accent)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
