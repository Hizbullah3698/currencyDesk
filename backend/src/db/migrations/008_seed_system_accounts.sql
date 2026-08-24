-- Structural seed data, not demo data — these are the same eight built-in accounts the old
-- frontend-only seed.ts created every time a browser's localStorage was empty. Now that Postgres
-- is the one shared source of truth, they're created exactly once, here, instead of on every
-- fresh client. created_by/updated_by are left NULL (no user authored these); the API resolves a
-- NULL created_by to the display string 'System' at response time, matching prior behavior.

INSERT INTO accounts (id, type, name, is_system, category, notes) VALUES
  ('bank', 'Bank', 'Bank', true, NULL, ''),
  ('cash', 'Cash', 'Cash in hand', true, NULL, 'Counter drawer.'),
  ('currency', 'Currency Stock', 'Currency stock (AED)', true, NULL,
     'Quantity and weighted-average cost are derived from the currency ledger.'),
  ('margin', 'Income', 'Margin / Income', true, NULL,
     'Trading margin on currency sales, plus anything journalled to Income.'),
  ('expense', 'Expense', 'Expenses', true, 'General', ''),
  ('salaryExpense', 'Expense', 'Salary Expense', true, 'Payroll',
     'Debited when a pay period is accrued.'),
  ('salaryPayable', 'Payable', 'Salary Payable', true, NULL,
     'Accrued salary not yet paid out.'),
  ('capital', 'Capital', 'Opening Balance / Capital', true, NULL, '');

UPDATE accounts SET code = 'AED' WHERE id = 'currency';

INSERT INTO stock_positions (code, available, avg_cost) VALUES ('AED', 0, 0);
