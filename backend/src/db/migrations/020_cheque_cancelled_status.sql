-- A fifth cheque status: 'Cancelled'.
--
-- A cheque entered by mistake had no way out. The only route off the uncleared list was
-- Deposited -> Returned, which writes a history saying the cheque went to the bank and bounced —
-- two events that never happened, on a record the client shows customers. Cancelling is the
-- honest alternative: the cheque never existed as far as the bank is concerned.
--
-- ONLY REACHABLE FROM 'Pending', enforced in chequeService.cancelCheque by the same
-- `WHERE status = '…'` guard the other transitions use. Once a cheque has been deposited it is
-- with the bank and its outcome is Cleared or Returned, not cancelled; once cleared it has moved
-- money, and undoing that is a reversal — the corrections feature that is scoped and deferred,
-- deliberately not smuggled in here.
--
-- Why the constraint has to be dropped and recreated rather than altered: Postgres has no
-- ALTER ... MODIFY CHECK. Recreating under the same name keeps the schema readable as one
-- statement of what a status may be, rather than an original list plus a patch.
ALTER TABLE cheques DROP CONSTRAINT cheques_status_check;

ALTER TABLE cheques ADD CONSTRAINT cheques_status_check
  CHECK (status IN ('Pending', 'Deposited', 'Cleared', 'Returned', 'Cancelled'));
