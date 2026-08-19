/** Credit/debit balances are always shown as positive numbers — sign is conveyed by a label, never a minus sign. */
export function fmt(n: number): string {
  return 'PKR ' + Math.round(n || 0).toLocaleString('en-US')
}

export function fmtNum(n: number, decimals = 0): string {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtRate(n: number): string {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtSigned(n: number): string {
  const s = fmt(Math.abs(n))
  return n < 0 ? '-' + s : s
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
