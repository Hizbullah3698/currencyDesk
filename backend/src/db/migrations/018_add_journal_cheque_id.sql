-- journal_entries.cheque_id — links a voucher leg back to the cheque whose clearing produced it.
--
-- Same shape and the same purpose as activity_id in migration 016: it says which real-world record
-- a leg came from. A leg has one or the other, never both, and manual entries, opening balances and
-- salary postings have neither.
--
-- WHY IT IS NEEDED NOW, WHEN 016 DELIBERATELY DID NOT ADD IT. Phase 3 posts a voucher when a cheque
-- clears, and 016's header already recorded that such a voucher references no activity row —
-- clearing is a transition on the cheque, not a new deal. That was harmless while vouchers were
-- only ever written forward, one per event, as it happened.
--
-- Phase 4 backfills vouchers for records predating phase 3, and a backfill has to be safely
-- re-runnable: a partial failure that cannot be resumed is a partial failure that has to be
-- unpicked by hand, against the live books. Answering "does this record already have its voucher?"
-- is an EXISTS check on the link column — which exists for activity rows and, until this migration,
-- did not for cheques. Without it the only ways to tell were matching on narration text or on
-- timestamps, both of which are guesses dressed up as keys.
--
-- clearCheque starts writing it from the same release, not just the backfill. Otherwise a cheque
-- cleared between this migration and the backfill run would have a voucher the backfill could not
-- see, and would be given a second one.
--
-- A real foreign key, unlike voucher_id. Cheques are a real table and a leg pointing at a cheque
-- that does not exist is a bug worth failing on; voucher_id groups legs and has no table behind it.

ALTER TABLE journal_entries
  ADD COLUMN cheque_id uuid REFERENCES cheques(id);

-- Partial, for the same reason as 016's two indexes: the overwhelming majority of rows have no
-- cheque behind them and never will.
CREATE INDEX IF NOT EXISTS journal_entries_cheque_idx ON journal_entries (cheque_id) WHERE cheque_id IS NOT NULL;
