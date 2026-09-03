import type { PoolClient } from 'pg'
import { openingStock } from '@currencydesk/engine'
import { mapActivityRow, mapStocks, type ActivityRow, type StockRow } from './mappers.js'
import { loadUserNames } from './userLookup.js'
import { postVoucher } from './journalService.js'
import { openingStockSides } from './voucherPostings.js'

// ---------------------------------------------------------------------------
// Journalling the currency the desk held before the ledger begins
// ---------------------------------------------------------------------------
//
// The balance sheet has exactly one legitimately unjournalled figure: currency held before the
// recorded activity history starts. It has no originating purchase to credit against, so
// computeBalanceSheet recovers it by unwinding activity through openingStock() and attributes it to
// equity via a presentation-only plug.
//
// Phase 4 turns that untracked exception into a real, checkable entry — Dr Currency Stock /
// Cr Capital — which is exactly what createAccount already does for customer, bank and cash opening
// balances. It is also what lets the reconciliation harness reach zero: without it the journal is
// permanently short by this amount for every stock account, and the harness would have to carry a
// tolerated residual forever, which is indistinguishable from a bug nobody has noticed.
//
// THE QUANTITY IS NOT RECOMPUTED HERE. It comes from the engine's openingStock(), the same replay
// computeBalanceSheet uses. Deriving it a second way is how the entry and the figure it is meant to
// replace end up disagreeing.

/** Below half a paisa there is no position worth an entry. */
const VALUE_TOLERANCE = 0.005

const CAPITAL_ACCOUNT = 'capital'

export interface OpeningStockResult {
  code: string
  accountId: string
  qty: number
  avgCost: number
  value: number
  txnDate: string
  posted: boolean
  /** Why it was skipped, when it was. */
  skipped?: string
}

/**
 * Posts one opening entry per Currency Stock account that has a pre-ledger position and does not
 * already have one.
 *
 * IDEMPOTENT via `opening_for`, the column createAccount already uses to mark an account's opening
 * balance. Re-running finds the existing entry and skips. That matters because this runs as part of
 * a backfill, and a backfill that cannot be safely resumed after a partial failure has to be
 * unpicked by hand against the live books.
 *
 * The entry carries a `voucher_id` as well, which keeps isVoucherLeg() excluding it from the
 * reports until phase 5 — see openingStockSides for why posting it as a visible entry would make
 * the balance sheet start reporting an imbalance that is not there.
 */
export async function postOpeningStockEntries(client: PoolClient, actorId: string | null): Promise<OpeningStockResult[]> {
  const names = await loadUserNames(client)

  // Sequential: one client runs one query at a time.
  const accounts = await client.query<{ id: string; code: string | null; created_at: Date }>(
    "SELECT id, code, created_at FROM accounts WHERE type = 'Currency Stock' ORDER BY created_at ASC, id ASC",
  )
  const activityRows = await client.query<ActivityRow>('SELECT * FROM activity ORDER BY created_at DESC')
  const stockRows = await client.query<StockRow>('SELECT * FROM stock_positions ORDER BY code')

  // includeMargin: true — this is an internal replay of the desk's own books, not a response to a
  // caller, and openingStock() needs the full picture.
  const activity = activityRows.rows.map((r) => mapActivityRow(r, names, true))
  const stocks = mapStocks(stockRows.rows)

  const results: OpeningStockResult[] = []

  for (const account of accounts.rows) {
    const code = account.code || 'AED'
    const { qty, avg } = openingStock(code, stocks, activity)
    const value = qty * avg

    // The date has to precede every movement in that currency, or a balance sheet cut between the
    // opening position and the first deal would show stock that had not been "acquired" yet. The
    // account's own creation date is not enough on its own: a backdated deal can be struck before
    // the account existed, so the earliest movement wins when it is earlier.
    const earliest = await client.query<{ first: string | null }>(
      "SELECT MIN(txn_date)::text AS first FROM activity WHERE COALESCE(currency, 'AED') = $1",
      [code],
    )
    const accountDay = new Date(account.created_at).toISOString().slice(0, 10)
    const firstMove = earliest.rows[0]?.first
    // The day before the first movement when there is one — that precedes every deal in this
    // currency however far back it was dated. With no movements at all there is nothing to precede,
    // so the account's own creation day stands.
    const txnDate = firstMove ? dayBefore(firstMove) : accountDay

    const existing = await client.query('SELECT 1 FROM journal_entries WHERE opening_for = $1 LIMIT 1', [account.id])
    if (existing.rows.length > 0) {
      results.push({ code, accountId: account.id, qty, avgCost: avg, value, txnDate, posted: false, skipped: 'already has an opening entry' })
      continue
    }

    if (Math.abs(value) <= VALUE_TOLERANCE) {
      results.push({ code, accountId: account.id, qty, avgCost: avg, value, txnDate, posted: false, skipped: 'no pre-ledger position' })
      continue
    }

    if (value < 0) {
      // openingStock unwinds sales back onto the position, so a negative here means the recorded
      // history sells more than it ever bought — a real data problem, not something to paper over
      // with a backwards entry.
      results.push({ code, accountId: account.id, qty, avgCost: avg, value, txnDate, posted: false, skipped: `negative opening position (${value})` })
      continue
    }

    const shape = openingStockSides({ stockAccount: account.id, capitalAccount: CAPITAL_ACCOUNT, currency: code, value })
    await postVoucher(
      client,
      {
        activityId: null,
        openingFor: account.id,
        txnDate,
        narration: shape.narration,
        legs: [{ debitAccount: account.id, creditAccount: CAPITAL_ACCOUNT, amount: value }],
      },
      actorId,
    )
    results.push({ code, accountId: account.id, qty, avgCost: avg, value, txnDate, posted: true })
  }

  return results
}

/** 'YYYY-MM-DD' one day earlier. Built from the parts rather than a Date so no timezone is involved. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}
