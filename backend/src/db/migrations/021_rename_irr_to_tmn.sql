-- Replace IRR (the Iranian Rial) with TMN (the Toman) as the desk's traded Iranian currency.
--
-- WHY. The client's dealers have only ever quoted and counted in Toman, never Rial, and the
-- client's own ledger books it that way ("Dubai Tmn 3,000,000,000@797"). 1 Toman = 10 Rial, so
-- keeping the desk's Iranian currency under the Rial's code meant typing Toman figures into a field
-- that means Rial — a tenfold booking error waiting for the first busy afternoon. The desk never
-- deals in actual Rial. This is a rename, not a relabel: the code, the stock position and the
-- stock account all change together, so nothing is left saying IRR over a number that means Toman.
--
-- WHAT THIS DOES NOT DO: rewrite any amount, rate, cost or balance. It cannot, and that is the
-- point of the guard below. If a single row anywhere is denominated in IRR, the figures on it are
-- RIAL figures, and relabelling them Toman would silently make them ten times too large. There is
-- no correct automatic conversion of an existing row — whether a given trade was keyed in Rial or
-- in Toman-by-mistake is a fact only a person can know — so this migration REFUSES rather than
-- guesses. Clear the data first (npm run reset:business) and re-run.
--
-- WHY THE HISTORY STAYS. Migrations 012 and 014 still say IRR, deliberately. They record what was
-- true on the day they ran; 012's own header spells out that a migration is a one-time fact, not a
-- description of the current schema. Editing 012 to seed TMN would leave this migration nothing to
-- rename on a fresh database, and would make a database built before 021 differ from one built
-- after it. So 012/014 keep their words, and this migration performs the change.
--
-- WHY NO CONSTRAINT CHANGES. The currency code sits in no CHECK constraint and no enum:
-- stock_positions.code is text PRIMARY KEY, accounts.code is plain text, and activity.currency is
-- plain text. The set of tradeable codes is enforced in application code (tradesService validates
-- against the engine's CURRENCIES). Hence this is a data rename only.
--
-- WHY THE ACCOUNT ID CAN CHANGE. 'currencyIRR' is not a core account — 012 and 014 both say so —
-- so protect_core_accounts does not apply. Nothing resolves a Currency Stock account by literal id;
-- accountHelpers.stockAccountIdFor() resolves by code. And seven foreign keys point at accounts(id)
-- with no ON UPDATE CASCADE, which is exactly why the guard requires zero referencing rows: with
-- none, changing the primary key cannot orphan anything.
--
-- closed periods (migration 019) store one pooled PKR margin figure and no currency code, so they
-- neither block this migration nor need rewriting by it.

-- ---------------------------------------------------------------------------
-- Guard: refuse if anything is denominated in, or refers to, IRR.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_activity   integer;
  n_journal    integer;
  n_refs       integer;
  n_stock      integer;
  n_tmn_stock  integer;
  n_tmn_acct   integer;
BEGIN
  SELECT count(*) INTO n_activity FROM activity WHERE upper(currency) = 'IRR';

  SELECT count(*) INTO n_journal FROM journal_entries
   WHERE debit_account = 'currencyIRR' OR credit_account = 'currencyIRR'
      OR opening_for = 'currencyIRR' OR salary_employee_id = 'currencyIRR';

  -- Every other place that can point at the account. activity.customer_id and cheques.customer_id
  -- can never legitimately be a Currency Stock account, so a hit there means something is already
  -- wrong; it is checked because the primary key is about to change under it.
  SELECT (SELECT count(*) FROM activity WHERE customer_id = 'currencyIRR' OR settlement_account_id = 'currencyIRR')
       + (SELECT count(*) FROM cheques  WHERE customer_id = 'currencyIRR' OR bank_account_id = 'currencyIRR')
    INTO n_refs;

  -- A stock position that still holds anything is a Rial position: units of Rial at a Rial cost.
  SELECT count(*) INTO n_stock FROM stock_positions
   WHERE code = 'IRR' AND (available <> 0 OR avg_cost <> 0);

  -- The target names must be free. If the app already created a TMN row (lockStock() makes a
  -- missing stock row on the first trade of a code), renaming onto it would collide — or, worse,
  -- merge two positions that were never meant to be one.
  SELECT count(*) INTO n_tmn_stock FROM stock_positions WHERE code = 'TMN';
  SELECT count(*) INTO n_tmn_acct  FROM accounts WHERE id = 'currencyTMN' OR upper(code) = 'TMN';

  IF n_activity > 0 OR n_journal > 0 OR n_refs > 0 OR n_stock > 0 THEN
    RAISE EXCEPTION
      'Migration 021 refuses to run: IRR data exists (activity rows: %, journal legs: %, other references: %, non-empty stock positions: %). These are Rial-denominated figures and cannot be relabelled Toman without making them ten times too large. Clear them first (npm run reset:business) and re-run. Nothing was changed.',
      n_activity, n_journal, n_refs, n_stock;
  END IF;

  IF n_tmn_stock > 0 OR n_tmn_acct > 0 THEN
    RAISE EXCEPTION
      'Migration 021 refuses to run: a TMN stock position or account already exists (stock rows: %, accounts: %). Renaming onto it would collide or merge two positions. Investigate before re-running. Nothing was changed.',
      n_tmn_stock, n_tmn_acct;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The rename.
-- ---------------------------------------------------------------------------
UPDATE stock_positions SET code = 'TMN', updated_at = now() WHERE code = 'IRR';

UPDATE accounts
   SET id   = 'currencyTMN',
       code = 'TMN',
       name = 'Currency stock (TMN)'
 WHERE id = 'currencyIRR';

-- ---------------------------------------------------------------------------
-- Verify, inside the same transaction, so a wrong result is never committed. Each figure is one
-- that would be expensive to discover afterwards.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_tmn_stock integer;
  n_tmn_acct  integer;
  n_irr_left  integer;
BEGIN
  SELECT count(*) INTO n_tmn_stock FROM stock_positions WHERE code = 'TMN';
  SELECT count(*) INTO n_tmn_acct  FROM accounts
   WHERE id = 'currencyTMN' AND upper(code) = 'TMN' AND type = 'Currency Stock' AND is_system = true;
  SELECT (SELECT count(*) FROM stock_positions WHERE code = 'IRR')
       + (SELECT count(*) FROM accounts WHERE id = 'currencyIRR' OR upper(code) = 'IRR')
    INTO n_irr_left;

  IF n_tmn_stock <> 1 OR n_tmn_acct <> 1 OR n_irr_left <> 0 THEN
    RAISE EXCEPTION
      'Migration 021 verification failed (TMN stock rows: %, TMN accounts: %, IRR rows left: %) — expected 1, 1, 0. Rolled back; nothing was changed.',
      n_tmn_stock, n_tmn_acct, n_irr_left;
  END IF;
END
$$;
