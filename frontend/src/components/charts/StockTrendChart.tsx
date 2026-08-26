import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import type { TrendBar } from '@/lib/engine'

interface StockTrendChartProps {
  data: TrendBar[]
  seriesLabel: string
  formatValue: (value: number) => string
  height?: number
  showAxis?: boolean
}

/**
 * Real chart (recharts) for a currency's running-stock trend, backed by
 * engine.ts's stockTrend() — replaces the earlier static styled-div bars.
 */
export function StockTrendChart({ data, seriesLabel, formatValue, height = 44, showAxis = false }: StockTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }} barCategoryGap="22%">
        {showAxis && (
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 10.5, fill: 'var(--color-muted-60)' }} />
        )}
        <Tooltip
          cursor={{ fill: 'var(--color-surface-hover)' }}
          contentStyle={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 11.5,
            padding: '6px 9px',
            boxShadow: 'var(--shadow-md)',
          }}
          labelStyle={{ color: 'var(--color-muted-60)', fontSize: 10.5, marginBottom: 2 }}
          formatter={(_value: unknown, _name: unknown, item: unknown) => {
            const raw = (item as { payload?: TrendBar })?.payload?.value ?? 0
            return [formatValue(raw), seriesLabel] as [string, string]
          }}
          labelFormatter={(label: unknown) => (label ? String(label) : 'Opening balance')}
        />
        {/* heightPct (never zero — floored at 10) keeps a visible baseline bar even when the
            real quantity is 0, matching the original div-based sparkline's behavior; the
            tooltip above still surfaces the real underlying quantity via payload.value. */}
        <Bar dataKey="heightPct" radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={28}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
