import type { PoolClient } from 'pg'
import type { Response } from 'express'
import { pool } from '../db/pool.js'
import { getSnapshot, type StateSnapshot } from './stateService.js'

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
 */
export async function runMutation(fn: (client: PoolClient) => Promise<void>): Promise<StateSnapshot> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await fn(client)
    const snapshot = await getSnapshot(client)
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
 * Route-handler convenience: run a mutation, send its snapshot as the response, or translate
 * an AppError into the matching status code. Lets every route body read as just its business
 * logic — see routes/trades.ts etc. for the pattern.
 */
export async function handleMutation(res: Response, fn: (client: PoolClient) => Promise<void>): Promise<void> {
  try {
    const snapshot = await runMutation(fn)
    res.json(snapshot)
  } catch (err) {
    if (isAppError(err)) {
      res.status(err.status).json({ error: err.message })
      return
    }
    throw err
  }
}
