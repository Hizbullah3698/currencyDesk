/**
 * The one matching rule used by every place in the app that filters a list as you type.
 *
 * Started as a private function inside Trade.tsx, was extracted when the ledger needed it, and now
 * also backs the combobox. Keeping it in one place is the whole point: two implementations of
 * "find the thing" drift — one gains trimming or case-insensitivity the other lacks — and a dealer
 * learns that searching behaves differently depending on which screen they happen to be on.
 */

/** Case-insensitive substring match across any number of fields, ignoring blank ones. */
export function matchesQuery(query: string, ...fields: (string | undefined | null)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => (f || '').toLowerCase().includes(q))
}

/**
 * Filters a list of named records.
 *
 * Deliberately a function rather than a component. The screens that pick a customer genuinely
 * differ in shape — a compact combobox on a dealing slip, a browsable list with balances on the
 * ledger — so sharing the matching rule is right where sharing the markup would force both into a
 * compromise that suits neither.
 */
export function customSearchFilter<T extends { name: string }>(customers: T[], q: string): T[] {
  return customers.filter((c) => matchesQuery(q, c.name))
}
