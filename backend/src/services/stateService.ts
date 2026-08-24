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
 * Every mutating endpoint calls this with the SAME client it just used for its own writes,
 * inside the still-open transaction, right before COMMIT — Postgres gives a transaction
 * read-your-own-writes visibility, so this is an atomic, consistent view of exactly what the
 * mutation produced. `GET /api/state` calls it with the plain pool instead.
 */
export async function getSnapshot(client: Pool | PoolClient): Promise<StateSnapshot> {
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

  return {
    accounts: accounts.rows.map((r) => mapAccountRow(r, names)),
    activity: activity.rows.map((r) => mapActivityRow(r, names)),
    cheques: cheques.rows.map((r) => mapChequeRow(r, names)),
    journalEntries: journalEntries.rows.map((r) => mapJournalRow(r, names)),
    stocks: mapStocks(stocks.rows),
  }
}
