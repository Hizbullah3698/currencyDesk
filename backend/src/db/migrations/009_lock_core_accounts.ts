import type { PoolClient } from 'pg'
import { CORE_ACCOUNT_IDS } from '@currencydesk/engine'

// DB-level enforcement of the same rule frontend/src/lib/store.tsx's `typeLockedFor`/
// `deleteAccount` have always enforced client-side: CORE_ACCOUNT_IDS accounts can never change
// type or be deleted, full stop — regardless of which code path touches the accounts table (a
// future API route, an admin script, or a raw query). This is a .ts migration rather than .sql
// specifically so the id list is imported from @currencydesk/engine, not hand-copied into SQL a
// second time — CORE_ACCOUNT_IDS has exactly one source of truth, this trigger's body is
// generated from it at migration-run time.
export async function up(client: PoolClient): Promise<void> {
  const idList = CORE_ACCOUNT_IDS.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ')

  await client.query(`
    CREATE OR REPLACE FUNCTION protect_core_accounts() RETURNS trigger AS $body$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.id IN (${idList}) THEN
          RAISE EXCEPTION 'Account "%" is a core system account and cannot be deleted — other parts of the app depend on it by id.', OLD.id
            USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.id IN (${idList}) AND NEW.type IS DISTINCT FROM OLD.type THEN
          RAISE EXCEPTION 'Account "%" is a core system account — its type cannot be changed, even by Admin.', OLD.id
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;
      RETURN NULL;
    END;
    $body$ LANGUAGE plpgsql;
  `)

  await client.query(`DROP TRIGGER IF EXISTS protect_core_accounts_trigger ON accounts`)
  await client.query(`
    CREATE TRIGGER protect_core_accounts_trigger
      BEFORE UPDATE OR DELETE ON accounts
      FOR EACH ROW EXECUTE FUNCTION protect_core_accounts()
  `)
}
