-- Two related schema changes the desk needed at the same time: trades gained a real
-- transaction date (distinct from when the row was keyed in), and the desk went from trading a
-- single currency (AED) to three (AED, AFN, IRR).
--
-- WHY THIS IS .sql AND NOT .ts, even though CURRENCY_LIST lives in TypeScript:
-- migrate.ts's rule is that a migration is .ts only when its content MUST be derived from
-- TypeScript source rather than hand-duplicated. That is true of 009_lock_core_accounts.ts —
-- its trigger body is a machine-generated projection of CORE_ACCOUNT_IDS and has no other
-- meaning. It is NOT true here. This migration is a one-time historical fact: "on the day the
-- desk added AFN and IRR, these rows were created." A migration runs exactly once and is then
-- recorded in schema_migrations forever, so deriving its row set from CURRENCY_LIST would NOT
-- keep the two in sync — adding a fourth currency to CURRENCY_LIST later would still need its
-- own new migration, while a database migrated before that change and one migrated after would
-- silently end up with different rows from the same migration name. Deriving it would buy no
-- sync and cost reproducibility. On top of that, most of what is written below (the account
-- ids, the display names, the notes text) is not derivable from CurrencyMeta at all.
-- The real coupling — "a code in CURRENCIES must have a stock_positions row" — is enforced
-- where it can actually hold at runtime instead: tradesService.ts validates input.currency
-- against CURRENCIES and lockStock() creates a missing row before locking it.

-- ---------------------------------------------------------------------------
-- activity.txn_date — the date the deal was struck, vs. created_at (when it was keyed in)
-- ---------------------------------------------------------------------------
-- Added nullable first, backfilled, and only then given its DEFAULT/NOT NULL, so an existing
-- populated table never transiently holds a wrong value. (Dev is empty right now; a real
-- deployment would not be.) The backfill casts created_at (timestamptz) to a date in the
-- database session's TimeZone — the desk's own local day, which is the day a pre-txn_date row
-- was in fact booked on.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS txn_date date;

UPDATE activity SET txn_date = created_at::date WHERE txn_date IS NULL;

ALTER TABLE activity ALTER COLUMN txn_date SET DEFAULT CURRENT_DATE;
ALTER TABLE activity ALTER COLUMN txn_date SET NOT NULL;

-- Reports (customer statements, balance sheet "as of", income statement periods) are cut on
-- this column, not on created_at.
CREATE INDEX IF NOT EXISTS activity_txn_date_idx ON activity (txn_date);

-- ---------------------------------------------------------------------------
-- stock_positions.avg_cost needs more decimals once a currency is worth < 1 PKR
-- ---------------------------------------------------------------------------
-- avg_cost is canonical PKR-per-unit. For AED (~78 PKR per unit) numeric(18,6) was ample. For
-- IRR one unit is worth ~0.000201917 PKR, which numeric(18,6) rounds to 0.000202 — measured
-- against a live Postgres, that is a 0.041% error on the cost basis, and because each purchase
-- re-weights against the value READ BACK from this column, the error compounds with every
-- posting rather than staying bounded. Widening to 12 decimals holds an IRR unit cost to nine
-- significant figures; 12 integer digits are still left, far more than any PKR-per-unit rate
-- needs. Widening a numeric is a lossless in-place change for every value already stored.
ALTER TABLE stock_positions ALTER COLUMN avg_cost TYPE numeric(24,12);

-- ---------------------------------------------------------------------------
-- Stock positions for the two new currencies
-- ---------------------------------------------------------------------------
INSERT INTO stock_positions (code, available, avg_cost) VALUES
  ('AFN', 0, 0),
  ('IRR', 0, 0)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- One Currency Stock account per new currency
-- ---------------------------------------------------------------------------
-- Mirrors migration 008's AED row (id 'currency', name 'Currency stock (AED)', is_system,
-- code). Each currency needs its own account so the Balance Sheet can carry it as its own line
-- at its own weighted-average cost rather than lumping three positions into one row.
--
-- These ids are deliberately NOT added to CORE_ACCOUNT_IDS: nothing resolves them by literal
-- id the way salary posting resolves 'salaryExpense'. Like the existing 'currency' row they
-- are ordinary is_system accounts — their real quantities live in stock_positions, not here.
--
-- ON CONFLICT DO NOTHING with no conflict target so it absorbs either unique constraint that
-- could already be satisfied: the id primary key, or accounts_name_lower_idx on lower(name).
INSERT INTO accounts (id, type, name, is_system, code, notes) VALUES
  ('currencyAFN', 'Currency Stock', 'Currency stock (AFN)', true, 'AFN',
     'Quantity and weighted-average cost are derived from the currency ledger.'),
  ('currencyIRR', 'Currency Stock', 'Currency stock (IRR)', true, 'IRR',
     'Quantity and weighted-average cost are derived from the currency ledger.')
ON CONFLICT DO NOTHING;
