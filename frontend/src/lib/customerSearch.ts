/**
 * The customer name filter used by every screen that picks a customer.
 *
 * Extracted from Trade.tsx, where it was a private function, when the ledger needed the same
 * behaviour. Two independent implementations of "find the customer" would drift — one gaining
 * case-insensitivity or trimming that the other lacked — and a dealer would learn that searching
 * works differently depending on which screen they are on.
 *
 * Deliberately a function rather than a component. The screens that pick a customer genuinely
 * differ in shape — the trade screen needs a compact dropdown beside a rate box, the ledger needs
 * a browsable list with balances — so sharing the matching rule is right where sharing the markup
 * would force both into a compromise that suits neither.
 */
export function customSearchFilter<T extends { name: string }>(customers: T[], q: string): T[] {
  const s = q.trim().toLowerCase()
  return s ? customers.filter((c) => c.name.toLowerCase().includes(s)) : customers
}
