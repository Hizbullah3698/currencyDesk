import { describe, it, expect } from 'vitest'
import { customSearchFilter, matchesQuery } from './customerSearch'

// One matching rule, used by the combobox on the dealing slips and by the ledger's browsable list.
// The reason it is shared, and tested, is that two copies drift: one picks up trimming or
// case-insensitivity the other lacks, and searching quietly behaves differently depending on which
// screen you are on.
describe('matchesQuery', () => {
  it('matches case-insensitively', () => {
    expect(matchesQuery('khan', 'Khan Traders')).toBe(true)
    expect(matchesQuery('KHAN', 'Khan Traders')).toBe(true)
  })

  it('matches a substring, not just a prefix', () => {
    // A dealer searching "sons" for "Khan & Sons" is the ordinary case, not an edge one.
    expect(matchesQuery('sons', 'Khan & Sons')).toBe(true)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesQuery('  khan  ', 'Khan Traders')).toBe(true)
  })

  it('treats an empty or whitespace-only query as matching everything', () => {
    // An empty search box shows the full list rather than nothing.
    expect(matchesQuery('', 'anything')).toBe(true)
    expect(matchesQuery('   ', 'anything')).toBe(true)
  })

  it('searches every field it is given, so a hint counts too', () => {
    // This is what lets someone type "Dirham" and find AED, whose label is just the code.
    expect(matchesQuery('dirham', 'AED', 'UAE Dirham')).toBe(true)
    expect(matchesQuery('aed', 'AED', 'UAE Dirham')).toBe(true)
  })

  it('tolerates a missing or empty field without matching on it', () => {
    expect(matchesQuery('x', 'AED', undefined)).toBe(false)
    expect(matchesQuery('x', 'AED', '')).toBe(false)
    expect(matchesQuery('aed', 'AED', null)).toBe(true)
  })

  it('does not match on something absent', () => {
    expect(matchesQuery('zzz', 'Khan Traders', 'Lahore')).toBe(false)
  })
})

describe('customSearchFilter', () => {
  const customers = [{ name: 'Khan Traders' }, { name: 'Wazir' }, { name: 'Al-Noor Exchange' }]

  it('narrows to the matches', () => {
    expect(customSearchFilter(customers, 'wa').map((c) => c.name)).toEqual(['Wazir'])
  })

  it('returns everything for an empty query rather than nothing', () => {
    expect(customSearchFilter(customers, '')).toHaveLength(3)
    expect(customSearchFilter(customers, '   ')).toHaveLength(3)
  })

  it('returns an empty list when nothing matches, not the full list', () => {
    expect(customSearchFilter(customers, 'zzz')).toHaveLength(0)
  })
})
