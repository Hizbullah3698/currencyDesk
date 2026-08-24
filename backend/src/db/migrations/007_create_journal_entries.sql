CREATE SEQUENCE journal_ref_seq START 1;

CREATE TABLE journal_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                 text NOT NULL
                        DEFAULT ('JV-' || lpad(nextval('journal_ref_seq')::text, 3, '0')),
  narration           text NOT NULL DEFAULT '',
  debit_account       text NOT NULL REFERENCES accounts(id),
  credit_account      text NOT NULL REFERENCES accounts(id),
  debit_label         text NOT NULL,
  credit_label        text NOT NULL,
  amount              numeric(18,2) NOT NULL CHECK (amount > 0),
  opening_for         text REFERENCES accounts(id),
  salary_employee_id  text REFERENCES accounts(id),
  salary_period       text,
  salary_kind         text CHECK (salary_kind IN ('accrual','payment')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX journal_entries_ref_uniq ON journal_entries (ref);

-- Turns "already accrued for this period" into a real, race-proof DB constraint instead of a
-- client-memory check — two concurrent "Accrue" requests for the same employee/period can only
-- ever produce one accrual row; the loser gets a clean 23505 to handle in Phase 2.
CREATE UNIQUE INDEX journal_entries_salary_accrual_uniq
  ON journal_entries (salary_employee_id, salary_period)
  WHERE salary_kind = 'accrual';

CREATE INDEX journal_entries_salary_employee_idx ON journal_entries (salary_employee_id);
