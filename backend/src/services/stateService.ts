import type { Pool, PoolClient } from 'pg'
import type { Account, Activity, Cheque, JournalEntry, Stocks } from '@currencydesk/engine'
import { loadUserNames } from './userLookup.js'
import { mapAccountRow, mapActivityRow, mapChequeRow, mapJournalRow, mapStocks, type AccountRow, type ActivityRow, type ChequeRow, type JournalRow, type StockRow } from './mappers.js'

export interface StateSnapshot {
  accounts: Account[]
  activity: Activity[]
  cheques: Cheque[]
  journalEntries: JournalEntry[]
  stocks: Stocks
}

/**
 * What the caller is allowed to see. Required, never defaulted — the whole point is that a new
 * call site has to state which view it wants rather than silently inheriting the permissive one.
 * That is exactly how per-deal margin came to be served to the Operator role in the first place.
 */
export interface SnapshotView {
  /**
   * Per-deal cost basis and realised margin. Admin-only: the UI already treats this as such
   * (`/income-statement` is behind RequireAdmin, and Stock.tsx replaces the movement-by-movement
   * ledger with a "restricted to Admin" card for Operators), so serving it to everyone made that
   * boundary decorative.
   *
   * Note what this does and does not achieve. It removes the desk's stated cost and profit from
   * the payload. It does NOT make margin unknowable in principle: purchase and sale rates are
   * still served to every role because the trade screens and the stock replay genuinely need
   * them, and current weighted-average cost is still on `stocks` because an Operator has to see
   * it to price a sale at all. Someone determined could approximate per-deal profit from those.
   * This closes the gap between what the UI claims is restricted and what the API hands over;
   * it is not a cryptographic boundary.
   */
  includeMargin: boolean
}

/** The session role is the authority, and anything that isn't 'admin' gets the restricted view. */
export function viewForRole(role: string | undefined): SnapshotView {
  return { includeMargin: role === 'admin' }
}

/**
 * Every mutating endpoint calls this with the SAME client it just used for its own writes,
 * inside the still-open transaction, right before COMMIT — Postgres gives a transaction
 * read-your-own-writes visibility, so this is an atomic, consistent view of exactly what the
 * mutation produced. `GET /api/state` calls it with the plain pool instead.
 *
 * `view` gates what the response carries — a mutation response is a full snapshot, so an
 * Operator's own trade response has to be filtered exactly like their GET /api/state is.
 */
export async function getSnapshot(client: Pool | PoolClient, view: SnapshotView): Promise<StateSnapshot> {
  const names = await loadUserNames(client as PoolClient)

  // Sequential, not Promise.all — when called with a PoolClient (every mutating endpoint calls
  // it that way, mid-transaction), a single client can only run one query at a time; firing
  // several concurrently on the same client is invalid and pg only warns about it today (it
  // will be a hard error in a future major version). A bare Pool could parallelize these safely,
  // but this function accepts both, so it always runs sequentially — five quick SELECTs, the
  // difference is not meaningful at this app's scale.
  const accounts = await client.query<AccountRow>('SELECT * FROM accounts ORDER BY id')
  const activity = await client.query<ActivityRow>('SELECT * FROM activity ORDER BY created_at DESC')
  const cheques = await client.query<ChequeRow>('SELECT * FROM cheques ORDER BY created_at DESC')
  const journalEntries = await client.query<JournalRow>('SELECT * FROM journal_entries ORDER BY created_at DESC')
  const stocks = await client.query<StockRow>('SELECT * FROM stock_positions ORDER BY code')

  // Which accounts are Income, so mapJournalRow can withhold entries that disclose the desk's
  // profit from a non-admin. Derived from the rows already read above rather than hardcoding
  // 'margin': an admin can create further Income accounts from the Accounts page, and a filter
  // that only knew about the seeded one would leak through every account added after it.
  const incomeAccountIds = new Set(accounts.rows.filter((a) => a.type === 'Income').map((a) => a.id))

  return {
    accounts: accounts.rows.map((r) => mapAccountRow(r, names)),
    activity: activity.rows.map((r) => mapActivityRow(r, names, view.includeMargin)),
    cheques: cheques.rows.map((r) => mapChequeRow(r, names)),
    // Nulls are omitted entries, not mapping failures — see mapJournalRow.
    journalEntries: journalEntries.rows
      .map((r) => mapJournalRow(r, names, view.includeMargin, incomeAccountIds))
      .filter((e): e is JournalEntry => e !== null),
    stocks: mapStocks(stocks.rows),
  }
}
