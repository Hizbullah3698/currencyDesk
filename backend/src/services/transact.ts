import type { PoolClient } from 'pg'
import type { Request, Response } from 'express'
import { pool } from '../db/pool.js'
import { getSnapshot, viewForRole, type SnapshotView, type StateSnapshot } from './stateService.js'

export interface AppError {
  status: number
  message: string
}

export function appError(status: number, message: string): AppError {
  return { status, message }
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'status' in e && 'message' in e && typeof (e as AppError).status === 'number'
}

/**
 * Runs `fn` on a single checked-out client inside one transaction — never per-statement
 * pool.query() calls, which would let BEGIN/a FOR UPDATE lock/COMMIT land on different pooled
 * connections and break transaction semantics entirely. Reads the fresh state snapshot with
 * the SAME client immediately before COMMIT (read-your-own-writes visibility, still atomic),
 * so the response is always exactly what the mutation produced. Throw `appError(status, msg)`
 * from `fn` for a clean 4xx; anything else rolls back and propagates for the global handler.
 *
 * `view` is required rather than defaulted: the snapshot this returns is the response body, so
 * a caller that doesn't state which view it wants would silently get the permissive one.
 */
export async function runMutation(fn: (client: PoolClient) => Promise<void>, view: SnapshotView): Promise<StateSnapshot> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await fn(client)
    const snapshot = await getSnapshot(client, view)
    await client.query('COMMIT')
    return snapshot
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Translates an AppError thrown while PARSING/VALIDATING a request body — i.e. before any
 * transaction is opened, so outside `handleMutation`'s own catch — into its clean 4xx, and
 * reports whether it did. Anything that isn't an AppError is left for the caller to rethrow.
 */
export function sendIfAppError(res: Response, err: unknown): boolean {
  if (!isAppError(err)) return false
  res.status(err.status).json({ error: err.message })
  return true
}

/**
 * Route-handler convenience: run a mutation, send its snapshot as the response, or translate
 * an AppError into the matching status code. Lets every route body read as just its business
 * logic — see routes/trades.ts etc. for the pattern.
 *
 * Takes `req` rather than a role argument on purpose. The response is a full snapshot, so it has
 * to be filtered to the caller's role exactly like GET /api/state is; reading the role off the
 * request here means a route physically cannot forget to pass it, and a call site written the old
 * way fails to compile instead of quietly serving Admin-only figures to an Operator.
 */
export async function handleMutation(res: Response, req: Request, fn: (client: PoolClient) => Promise<void>): Promise<void> {
  try {
    const snapshot = await runMutation(fn, viewForRole(req.session.role))
    res.json(snapshot)
  } catch (err) {
    if (isAppError(err)) {
      res.status(err.status).json({ error: err.message })
      return
    }
    throw err
  }
}
