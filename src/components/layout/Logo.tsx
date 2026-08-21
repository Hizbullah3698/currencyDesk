export function Logo({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ display: 'block', flex: 'none' }}>
      <path d="M2.5 6.5h13l-3-3" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="square" />
      <path d="M17.5 13.5h-13l3 3" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  )
}
