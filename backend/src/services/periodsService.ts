import type { PoolClient } from 'pg'
import { periodLabel } from '@currencydesk/engine'
import { appError } from './transact.js'

const PERIOD_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function assertValidId(id: string): void {
  if (!PERIOD_ID_RE.test(id)) throw appError(400, 'Enter a period as YYYY-MM, e.g. 2026-09.')
}

function monthBounds(id: string): { start: string; end: string } {
  const [y, m] = id.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate() // day 0 of next month = last day of this one
  return { start: `${id}-01`, end: `${id}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * Blocks a new Sale/Purchase from backdating into an already-closed period. Scoped to trades
 * only — see the engine's Period doc comment — so manual journal entries are unaffected, and
 * since trades have no edit/delete routes at all (append-only), this IS the enforcement: there
 * is nothing else on an already-posted row for a period close to lock.
 */
export async function assertPeriodOpen(client: PoolClient, txnDate: string): Promise<void> {
  const id = txnDate.slice(0, 7)
  const { rows } = await client.query<{ reopened_at: Date | null }>('SELECT reopened_at FROM periods WHERE id = $1', [id])
  if (rows.length > 0 && rows[0].reopened_at == null) {
    throw appError(409, `${periodLabel(id)} is closed for trading. An admin can reopen it from the Margin Ledger before this can be posted.`)
  }
}

/**
 * Locks in the period's realized sales margin, summed straight from the SAME persisted,
 * weighted-average-cost `activity.margin` values the Margin Ledger displays for that range — so
 * the frozen figure can never disagree with what was on screen at the moment of closing, and
 * never moves again even if a later rate or setting change would recompute it differently.
 *
 * Refuses to re-close an already-closed period outright (reopen it first) so "permanently fixed"
 * actually holds — closing twice in a row would otherwise silently overwrite the frozen figure.
 */
export async function closePeriod(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  assertValidId(id)
  const { rows: existing } = await client.query<{ reopened_at: Date | null }>('SELECT reopened_at FROM periods WHERE id = $1', [id])
  if (existing.length > 0 && existing[0].reopened_at == null) {
    throw appError(409, `${periodLabel(id)} is already closed.`)
  }

  const { start, end } = monthBounds(id)
  const { rows: sum } = await client.query<{ total: number }>(
    `SELECT COALESCE(SUM(margin), 0) AS total FROM activity WHERE type = 'sale' AND txn_date BETWEEN $1::date AND $2::date`,
    [start, end],
  )

  await client.query(
    `INSERT INTO periods (id, closed_margin, closed_at, closed_by, reopened_at, reopened_by)
     VALUES ($1, $2, now(), $3, NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET closed_margin = $2, closed_at = now(), closed_by = $3, reopened_at = NULL, reopened_by = NULL`,
    [id, sum[0].total, actorId],
  )
}

/** Requires an explicit admin action, per the requirement — there is no implicit reopen. */
export async function reopenPeriod(client: PoolClient, id: string, actorId: string | null): Promise<void> {
  assertValidId(id)
  const { rows } = await client.query<{ reopened_at: Date | null }>('SELECT reopened_at FROM periods WHERE id = $1', [id])
  if (rows.length === 0) throw appError(400, `${periodLabel(id)} has never been closed.`)
  if (rows[0].reopened_at != null) throw appError(409, `${periodLabel(id)} is already open.`)
  await client.query('UPDATE periods SET reopened_at = now(), reopened_by = $2 WHERE id = $1', [id, actorId])
}
