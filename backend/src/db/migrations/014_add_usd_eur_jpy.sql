-- The desk goes from three traded currencies to the client's full six: adds USD, EUR and JPY
-- alongside the existing AED, AFN and IRR.
--
-- WHY THIS IS .sql AND NOT .ts, for the same reason migration 012 gave: migrate.ts's rule is that
-- a migration is .ts only when its content MUST be derived from TypeScript source. That is true of
-- 009_lock_core_accounts.ts, whose trigger body is a machine-generated projection of
-- CORE_ACCOUNT_IDS. It is not true here. This is a one-time historical fact — "on the day the desk
-- added USD, EUR and JPY, these rows were created". A migration runs once and is then recorded
-- forever, so deriving the row set from CURRENCY_LIST would NOT keep the two in sync: a seventh
-- currency later would still need its own migration, while databases migrated before and after
-- that change would silently end up with different rows from the same migration name. The real
-- coupling — "a code in CURRENCIES must have a stock_positions row" — is enforced where it can
-- actually hold at runtime: tradesService.ts validates against CURRENCIES, and lockStock() creates
-- a missing row before locking it.
--
-- NOTHING STRUCTURAL IS NEEDED. All three are ordinary 'multiply' quotes, exactly like AED, so no
-- new mechanism is involved. The one genuinely awkward case, IRR — quoted inverted, and needing
-- avg_cost widened to numeric(24,12) to hold a unit cost of ~0.0002 PKR without compounding
-- rounding error — was solved in migration 012 and covers these too. The weakest currency added
-- here is JPY at roughly 1.9 PKR per unit, which is nowhere near that precision floor.

-- ---------------------------------------------------------------------------
-- Stock positions
-- ---------------------------------------------------------------------------
INSERT INTO stock_positions (code, available, avg_cost) VALUES
  ('USD', 0, 0),
  ('EUR', 0, 0),
  ('JPY', 0, 0)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- One Currency Stock account per new currency
-- ---------------------------------------------------------------------------
-- Mirrors migration 012's AFN/IRR rows exactly, which in turn mirror 008's original AED row. Each
-- currency needs its own account so the Balance Sheet carries it as its own line at its own
-- weighted-average cost, rather than lumping several positions into one row.
--
-- Deliberately NOT added to CORE_ACCOUNT_IDS: nothing resolves these by literal id the way salary
-- posting resolves 'salaryExpense'. They are ordinary is_system accounts, and their real
-- quantities live in stock_positions rather than here.
--
-- ON CONFLICT DO NOTHING with no conflict target, so it absorbs either unique constraint that
-- could already be satisfied: the id primary key, or accounts_name_lower_idx on lower(name).
INSERT INTO accounts (id, type, name, is_system, code, notes) VALUES
  ('currencyUSD', 'Currency Stock', 'Currency stock (USD)', true, 'USD',
     'Quantity and weighted-average cost are derived from the currency ledger.'),
  ('currencyEUR', 'Currency Stock', 'Currency stock (EUR)', true, 'EUR',
     'Quantity and weighted-average cost are derived from the currency ledger.'),
  ('currencyJPY', 'Currency Stock', 'Currency stock (JPY)', true, 'JPY',
     'Quantity and weighted-average cost are derived from the currency ledger.')
ON CONFLICT DO NOTHING;
