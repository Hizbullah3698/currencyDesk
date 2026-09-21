import { describe, it, expect } from 'vitest'
import { STATEMENT_CONFIG as C } from './statementConfig'

describe('statement config', () => {
  it('keeps at least three entries with the closing balance', () => {
    expect(C.keepWithClosing).toBeGreaterThanOrEqual(3)
  })

  it('has column widths that add up to the printable width', () => {
    const printable = C.page.width - C.margin.left - C.margin.right
    const cols = C.columns
    expect(cols.description + cols.ref + cols.debit + cols.credit + cols.balance).toBeCloseTo(printable, 6)
  })

  it('shows exact paisa by default: whole rupees is a deliberate choice for the client, not the default', () => {
    expect(C.amountDecimals).toBe(2)
  })

  it('uses a placeholder desk name until branding is real data', () => {
    expect(C.deskName).toBe('DESK NAME')
  })
})
