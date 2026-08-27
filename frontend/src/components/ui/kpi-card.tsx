import type { ReactNode, ComponentType } from 'react'

/**
 * Bold solid-fill identity for headline stat cards across the app — a
 * deliberately louder treatment than the rest of the app's soft-tint
 * convention, by request, for a client who scans screens visually rather
 * than reading them line by line. Every *-solid token this reads is checked
 * at >=4.5:1 for the white text/icons sitting on it (see index.css) — the
 * fill carries the color, not the numbers, which is what keeps this
 * readable instead of just loud.
 *
 * Tone meanings (kept fixed so the same tone always means the same thing
 * everywhere it's used):
 *  - positive/negative: a genuinely two-directional business state — a
 *    receivable vs a payable, a net movement that can land on either side of
 *    zero. Reuses the app's real signed-value tokens.
 *  - inflow/outflow: a routine, one-directional total (Dashboard's Sales vs
 *    Purchases today) — a purchase is not a loss, so this deliberately does
 *    NOT borrow the negative/red language.
 *  - accent: a neutral headline total with no positive/negative charge of
 *    its own (a cumulative count, an informational figure).
 */
export const KPI_TONE = {
  inflow: { solid: 'var(--color-inflow-solid)', glow: 'var(--color-inflow-glow)' },
  outflow: { solid: 'var(--color-outflow-solid)', glow: 'var(--color-outflow-glow)' },
  positive: { solid: 'var(--color-positive-solid)', glow: 'var(--color-positive-glow)' },
  negative: { solid: 'var(--color-negative-solid)', glow: 'var(--color-negative-glow)' },
  accent: { solid: 'var(--color-accent-solid)', glow: 'var(--color-accent-glow)' },
} as const

export type KpiTone = keyof typeof KPI_TONE

function toneStyle(tone: KpiTone) {
  const t = KPI_TONE[tone]
  return {
    background: `radial-gradient(120% 130% at 100% 115%, rgba(255,255,255,0.20), transparent 55%), linear-gradient(135deg, ${t.solid}, color-mix(in srgb, ${t.solid} 100%, black 26%))`,
    boxShadow: `0 14px 30px -10px ${t.glow}, 0 2px 8px -2px rgba(0, 0, 0, 0.28)`,
    border: '1px solid rgba(255, 255, 255, 0.16)',
  }
}

/** Whole-card solid fill — for a card whose entire content is the one headline stat (Dashboard's 3 KPI tiles, a simple two-up stat pair). */
export function KpiCard({
  tone,
  icon: Icon,
  label,
  className,
  children,
}: {
  tone: KpiTone
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`relative overflow-hidden rounded-[10px] px-6 pb-6 pt-[22px] shadow-lg transition-shadow duration-150 ${className || ''}`} style={toneStyle(tone)}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-[6px] bg-white/22 text-white">
          <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <span className="text-meta font-medium uppercase tracking-wider text-white/85">{label}</span>
      </div>
      {children}
    </div>
  )
}

/**
 * Colored solid header + neutral card body below — for a stat that needs a
 * bold headline number PLUS supporting breakdown detail (a customer's
 * receivable original/settled/remaining). The header is print-safe the same
 * way KpiCard is (the print stylesheet forces every *-solid token back to a
 * fixed light value), which matters here specifically since this variant is
 * used on a printed customer statement.
 */
export function KpiBannerCard({
  tone,
  icon: Icon,
  label,
  headline,
  sub,
  footer,
  className,
}: {
  tone: KpiTone
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  headline: ReactNode
  sub?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-[10px] shadow-lg print:shadow-none ${className || ''}`} style={{ border: '1px solid var(--color-border)' }}>
      <div className="relative px-3.5 py-3" style={toneStyle(tone)}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px] bg-white/22 text-white">
            <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="text-meta font-semibold uppercase tracking-wide text-white/85">{label}</span>
        </div>
        <div className="tabular text-hero font-semibold tracking-tight text-white">{headline}</div>
        {sub && <div className="mt-0.5 text-meta font-normal text-white/75">{sub}</div>}
      </div>
      {footer && <div className="bg-surface px-3.5 py-3">{footer}</div>}
    </div>
  )
}
