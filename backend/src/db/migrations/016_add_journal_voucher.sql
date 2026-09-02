-- Groups journal entries into vouchers, and links them back to the deal they came from.
--
-- Requirement 7 makes trades and settlements post real paired entries. The obstacle is that this
-- table is strictly two-legged — one debit_account, one credit_account, one amount — while a sale
-- settled partly in cash needs four legs: cash and the customer on the debit side, currency stock
-- and trading margin on the credit side. The most common transaction the desk performs cannot be
-- written as a single row here.
--
-- WHY A VOUCHER COLUMN AND NOT A HEADER/LINES RESTRUCTURE. The textbook shape is one voucher
-- header with N lines, and it is what an accountant expects. It also rewrites every existing
-- consumer of this table: ledgerBalance(), marginLedger(), the Journal page, salary accrual and
-- payment, opening balances, and the balance-sheet reconciliation — none of which have anything
-- wrong with them today. A voucher_id instead lets one deal be several balanced two-leg rows that
-- every one of those readers continues to read unchanged, while still giving the client the thing
-- they actually asked for: one identifiable record to point at per deal. If manual multi-line
-- vouchers are ever wanted, the restructure is still open; this does not foreclose it.
--
-- WHY BOTH COLUMNS. They answer different questions and neither implies the other:
--   voucher_id  — "which legs make up this one deal", the grouping a reader needs.
--   activity_id — "which activity row produced this leg", the link back to the source document.
-- A manual journal entry has neither. A trade's legs have both. A future correction voucher will
-- have a voucher_id but may reference no activity row at all, which is why activity_id is not
-- simply reused as the grouping key.
--
-- voucher_id is deliberately NOT a foreign key: there is no voucher table, and inventing one would
-- be the header/lines restructure by another name. It is a grouping id minted per deal. activity_id
-- IS a foreign key, because activity rows genuinely exist and a leg pointing at a missing one would
-- be a bug worth failing on.
--
-- Nothing writes either column yet. This migration is deliberately inert: it ships ahead of the
-- code that uses it so the column is already in place when that code lands, which is the ordering
-- the 2026-08-31 entry in PROJECT_STATUS.md records getting wrong once and catching in time.

ALTER TABLE journal_entries
  ADD COLUMN voucher_id  uuid,
  ADD COLUMN activity_id uuid REFERENCES activity(id);

-- Partial: the overwhelming majority of existing rows have neither, and will keep having neither
-- (manual entries, opening balances, salary postings are all single-leg-pair events).
CREATE INDEX journal_entries_voucher_idx  ON journal_entries (voucher_id)  WHERE voucher_id  IS NOT NULL;
CREATE INDEX journal_entries_activity_idx ON journal_entries (activity_id) WHERE activity_id IS NOT NULL;
