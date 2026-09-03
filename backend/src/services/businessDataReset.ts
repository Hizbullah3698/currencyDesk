import type { PoolClient } from 'pg'
import { CORE_ACCOUNT_IDS } from '@currencydesk/engine'

// ---------------------------------------------------------------------------
// Clearing the desk back to a blank set of books
// ---------------------------------------------------------------------------
//
// For one purpose: removing practice data before the client starts trading for real. It is not a
// feature of the app and is deliberately not reachable from it.
//
// WHY TARGETED DELETES AND NEVER TRUNCATE. The obvious implementation is the one the test fixture
// uses — TRUNCATE the business tables and reseed. That is right for a disposable test database and
// wrong here, for a specific reason rather than a vague one: migration 009's protect_core_accounts
// trigger is BEFORE UPDATE OR DELETE ... FOR EACH ROW, and TRUNCATE does not fire row-level DELETE
// triggers. TRUNCATE accounts would therefore walk straight past the guard that exists to stop
// exactly this, and take the structural chart of accounts with it. A targeted DELETE leaves the
// guard armed: if this code ever tried to remove a core account, the database itself would refuse.
//
// The "clean" bulk operation is the dangerous one here. That is worth knowing before someone
// simplifies this later.
//
// WHAT IT REMOVES: journal entries, activity, cheques, and non-system accounts (customers,
// employees, and any bank/expense accounts the client added). Stock positions are zeroed rather
// than deleted — lockStock() depends on a row existing per traded currency, and the migrations seed
// exactly those rows.
//
// WHAT IT LEAVES ALONE: the schema and migration history, the 13 structural system accounts, the
// `users` table and everyone's logins, `session`, `app_settings`, and the CSRF and rate-limit
// tables. Removing a login is a different decision with a different blast radius — nobody can sign
// in afterwards without terminal access to the database — so it is deliberately not this script's
// job.
//
// The transaction is the CALLER's, so the script can report and roll back for a dry run.

export interface ResetCounts {
  journalEntries: number
  activity: number
  cheques: number
  nonSystemAccounts: number
  stockPositionsZeroed: number
}

export interface ResetReport {
  before: ResetCounts
  deleted: ResetCounts
  after: ResetCounts
  /** Names of the non-system accounts removed, so a dry run shows WHO, not just how many. */
  removedAccounts: { id: string; type: string; name: string }[]
  /** Every assertion that ran before commit, and whether it held. */
  checks: { what: string; expected: string; actual: string; ok: boolean }[]
}

async function counts(client: PoolClient): Promise<ResetCounts> {
  const n = async (sql: string) => Number((await client.query<{ n: string }>(sql)).rows[0].n)
  return {
    journalEntries: await n('SELECT COUNT(*) AS n FROM journal_entries'),
    activity: await n('SELECT COUNT(*) AS n FROM activity'),
    cheques: await n('SELECT COUNT(*) AS n FROM cheques'),
    nonSystemAccounts: await n('SELECT COUNT(*) AS n FROM accounts WHERE is_system = false'),
    stockPositionsZeroed: await n('SELECT COUNT(*) AS n FROM stock_positions WHERE available <> 0 OR avg_cost <> 0'),
  }
}

export async function resetBusinessDataForGoLive(client: PoolClient): Promise<ResetReport> {
  const before = await counts(client)
  // Captured up front so "untouched" can be asserted as a comparison rather than a guess. A check
  // that reads the same value twice and compares it to itself proves nothing.
  const usersBefore = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM users')).rows[0].n)
  const sessionsBefore = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM session')).rows[0].n)

  const { rows: removedAccounts } = await client.query<{ id: string; type: string; name: string }>(
    'SELECT id, type, name FROM accounts WHERE is_system = false ORDER BY type, name',
  )

  // FK order. journal_entries points at activity, cheques and accounts; activity points at cheques
  // and accounts; cheques point at accounts. Children first, and no CASCADE anywhere — if something
  // unexpected references a row, this should fail rather than quietly widen its own blast radius.
  const delJournal = await client.query('DELETE FROM journal_entries')
  const delActivity = await client.query('DELETE FROM activity')
  const delCheques = await client.query('DELETE FROM cheques')
  // The core-account trigger stays armed for this one. is_system = false is the filter; the trigger
  // is the backstop if that filter is ever wrong.
  const delAccounts = await client.query('DELETE FROM accounts WHERE is_system = false')

  // Zeroed, not deleted: lockStock() needs a row per traded currency and the migrations seed them.
  const zeroed = await client.query('UPDATE stock_positions SET available = 0, avg_cost = 0, updated_at = now()')

  // So the client's first real entry is JV-001 and their first cheque numbers from the start.
  await client.query('ALTER SEQUENCE journal_ref_seq RESTART WITH 1')
  await client.query('ALTER SEQUENCE cheque_number_seq RESTART WITH 1')

  const after = await counts(client)

  // Assertions run BEFORE the caller commits, so a corrupted result is never visible. Each is
  // something that would be expensive to discover afterwards.
  const systemAccounts = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM accounts WHERE is_system = true')).rows[0].n)
  const corePresent = Number(
    (await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM accounts WHERE id = ANY($1::text[])', [CORE_ACCOUNT_IDS])).rows[0].n,
  )
  const stockRows = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM stock_positions')).rows[0].n)
  const migrations = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM schema_migrations')).rows[0].n)
  const users = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM users')).rows[0].n)
  const settings = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM app_settings')).rows[0].n)
  const sessions = Number((await client.query<{ n: string }>('SELECT COUNT(*) AS n FROM session')).rows[0].n)

  const checks: ResetReport['checks'] = [
    { what: 'structural system accounts kept', expected: '13', actual: String(systemAccounts), ok: systemAccounts === 13 },
    { what: 'every core account still present', expected: String(CORE_ACCOUNT_IDS.length), actual: String(corePresent), ok: corePresent === CORE_ACCOUNT_IDS.length },
    { what: 'stock rows kept (zeroed, not deleted)', expected: '6', actual: String(stockRows), ok: stockRows === 6 },
    { what: 'schema untouched', expected: '18 migrations', actual: `${migrations} migrations`, ok: migrations === 18 },
    { what: 'logins untouched', expected: `${usersBefore} users`, actual: `${users} users`, ok: users === usersBefore },
    { what: 'sessions untouched', expected: `${sessionsBefore} sessions`, actual: `${sessions} sessions`, ok: sessions === sessionsBefore },
    { what: 'settings untouched', expected: '1 setting', actual: `${settings} settings`, ok: settings === 1 },
    { what: 'no business data left', expected: '0 / 0 / 0 / 0', actual: `${after.journalEntries} / ${after.activity} / ${after.cheques} / ${after.nonSystemAccounts}`, ok: after.journalEntries === 0 && after.activity === 0 && after.cheques === 0 && after.nonSystemAccounts === 0 },
    { what: 'no stock position left holding value', expected: '0', actual: String(after.stockPositionsZeroed), ok: after.stockPositionsZeroed === 0 },
  ]

  return {
    before,
    deleted: {
      journalEntries: delJournal.rowCount ?? 0,
      activity: delActivity.rowCount ?? 0,
      cheques: delCheques.rowCount ?? 0,
      nonSystemAccounts: delAccounts.rowCount ?? 0,
      stockPositionsZeroed: zeroed.rowCount ?? 0,
    },
    after,
    removedAccounts,
    checks,
  }
}
