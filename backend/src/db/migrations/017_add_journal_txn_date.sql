-- journal_entries.txn_date — the day the entry belongs to, vs. created_at (when it was keyed in).
--
-- The same document-date/posting-date split activity.txn_date already carries, extended to the
-- journal. Migration 012 added that column and this follows its shape deliberately, including the
-- add-nullable / backfill / set-default / set-not-null ordering, so an already-populated table
-- never transiently holds a wrong value.
--
-- WHY ITS OWN COLUMN RATHER THAN READING THE DATE THROUGH activity_id. Requirement 7 links a
-- voucher leg to the trade that produced it, so a join could in principle supply the date. It was
-- rejected because two whole classes of entry have no activity row to join to:
--
--   * Manual journal entries, opening balances and salary postings — all already shipped, none of
--     which has ever had an activity_id. Under the join approach every one of them would report no
--     transaction date at all, silently dropping out of any report cut on that date.
--   * Correction and reversal vouchers, scoped but not yet built. A reversal may reference no
--     activity row at all, and the client has already settled that corrections post on TODAY'S
--     date rather than the date of the entry being corrected — a date a join to the original could
--     never produce, because it is deliberately not the original's date.
--
-- So the join would have been wrong for the entries that exist today and wrong again for the ones
-- coming next.
--
-- HOW PHASE 3 MUST POPULATE IT. When a voucher is written from a trade or settlement, copy the
-- date from that activity row AT WRITE TIME. Do not join to it at read time. The value is a fact
-- about the voucher once posted, not a view onto another row that could later move underneath it —
-- and the whole reason this column exists is that some vouchers have no such row to look at.
--
-- WHY NOT NAMED transaction_date. activity.txn_date is the established name for exactly this
-- concept in this schema, and the engine already exposes it as `txnDate`; a second spelling for the
-- same idea is how two names for one thing start. Read through the engine's activityDate() helper
-- family for the same timezone-pinning reasons documented in CLAUDE.md.
--
-- Reports are NOT switched onto this column here. ledgerBalance() still cuts journal entries on
-- created_at, and changing that would move reported figures — which the requirement 7 acceptance
-- test forbids. The switch belongs to phase 5, alongside retiring the four reconstructions.

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS txn_date date;

-- Cast in the database session's TimeZone — the desk's own local day, which is the day a
-- pre-txn_date entry was in fact booked on. Identical reasoning to migration 012's backfill.
UPDATE journal_entries SET txn_date = created_at::date WHERE txn_date IS NULL;

ALTER TABLE journal_entries ALTER COLUMN txn_date SET DEFAULT CURRENT_DATE;
ALTER TABLE journal_entries ALTER COLUMN txn_date SET NOT NULL;

-- Reporting periods will be cut on this column once phase 5 switches them over.
CREATE INDEX IF NOT EXISTS journal_entries_txn_date_idx ON journal_entries (txn_date);
