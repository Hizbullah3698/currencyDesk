-- Margin Ledger period close (requirement: monthly close of realized sales margin).
--
-- Scoped to Sale/Purchase only, not a full accounting-grade close — see periodsService.ts and
-- the engine's Period type doc comment. `id` is the calendar month itself ('YYYY-MM'), which
-- doubles as the natural primary key: there is exactly one close record per month.
--
-- The row is kept on reopen rather than deleted, so `closed_margin`/`closed_at`/`closed_by`
-- remain a record of the last close instead of vanishing — `reopened_at IS NULL` is what "closed"
-- actually means, not "a row exists". Closing again after a reopen overwrites the three closed_*
-- columns with a fresh snapshot and clears reopened_at/reopened_by back to NULL.
CREATE TABLE periods (
  id            text PRIMARY KEY,
  closed_margin numeric(18,2) NOT NULL,
  closed_at     timestamptz NOT NULL DEFAULT now(),
  closed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  reopened_at   timestamptz,
  reopened_by   uuid REFERENCES users(id) ON DELETE SET NULL
);
