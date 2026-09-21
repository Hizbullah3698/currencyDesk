import { describe, it, expect } from 'vitest'
import { formatBalance, formatPaisa, formatRate, formatUnits, rupeesToPaisa } from './statementMoney'

describe('statement money — always whole paisa underneath', () => {
  it('converts rupees to paisa on the decimal digits, so a float artefact cannot move a figure', () => {
    expect(rupeesToPaisa(3807106.6)).toBe(380_710_660)
    // A sum of floats drifts off the exact figure (here by ~2e-10); the paisa must not follow it.
    const drifted = 1269035.53 + 3807106.6 - 3807106.6
    expect(drifted).not.toBe(1269035.53)
    expect(rupeesToPaisa(drifted)).toBe(126_903_553)
    expect(rupeesToPaisa(1269035.53)).toBe(126_903_553)
    expect(rupeesToPaisa(0.1 + 0.2)).toBe(30)
    expect(rupeesToPaisa(-40000)).toBe(-4_000_000)
  })

  it('prints exact paisa with thousands separators', () => {
    expect(formatPaisa(380_710_660, 2)).toBe('3,807,106.60')
    expect(formatPaisa(100_000_000_000, 2)).toBe('1,000,000,000.00')
    expect(formatPaisa(5, 2)).toBe('0.05')
    expect(formatPaisa(0, 2)).toBe('0.00')
  })

  it('shows a negative as its magnitude — the sign lives in Dr/Cr, never a minus', () => {
    expect(formatPaisa(-380_710_660, 2)).toBe('3,807,106.60')
  })

  it('rounds half away from zero for the whole-rupee setting', () => {
    expect(formatPaisa(49, 0)).toBe('0')
    expect(formatPaisa(50, 0)).toBe('1')
    expect(formatPaisa(149, 0)).toBe('1')
    expect(formatPaisa(150, 0)).toBe('2')
    expect(formatPaisa(474_985_569, 0)).toBe('4,749,856')
  })

  it('prints a balance with its side and never a minus sign', () => {
    expect(formatBalance(474_985_569, 2)).toBe('4,749,855.69 Dr')
    expect(formatBalance(-474_985_569, 2)).toBe('4,749,855.69 Cr')
    expect(formatBalance(-474_985_569, 2)).not.toContain('-')
  })

  it('prints a settled balance bare, since nothing owed has no side', () => {
    expect(formatBalance(0, 2)).toBe('0.00')
    expect(formatBalance(0, 0)).toBe('0')
    // A whole-rupee balance that rounds to nothing has no side either.
    expect(formatBalance(30, 0)).toBe('0')
  })

  it('reads quantities and rates the way a dealer does', () => {
    expect(formatUnits(3_000_000_000, 0)).toBe('3,000,000,000')
    expect(formatUnits(-500, 0)).toBe('500')
    expect(formatRate(788, 2)).toBe('788')
    expect(formatRate(80, 2)).toBe('80')
    expect(formatRate(4952.53, 2)).toBe('4,952.53')
    expect(formatRate(77.5, 2)).toBe('77.5')
  })
})
