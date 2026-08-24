CREATE SEQUENCE cheque_number_seq START 1001;

CREATE TABLE cheques (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction        text NOT NULL CHECK (direction IN ('Inward','Outward')),
  number           text NOT NULL,
  party            text NOT NULL,
  customer_id      text REFERENCES accounts(id),
  bank             text NOT NULL,
  bank_account_id  text NOT NULL REFERENCES accounts(id),
  amount           numeric(18,2) NOT NULL,
  due_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'Pending'
                     CHECK (status IN ('Pending','Deposited','Cleared','Returned')),
  ledger_applied   boolean NOT NULL DEFAULT false,
  history          text[] NOT NULL DEFAULT '{}',
  source           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Real uniqueness constraint, not just an app-level pre-check — closes the race where two
-- concurrent trades/settlements with a blank cheque number could otherwise both compute the
-- same "next free number" from the same snapshot. The Phase 2 insert path must catch a 23505
-- violation on this index and retry with a freshly recomputed number.
CREATE UNIQUE INDEX cheques_number_uniq ON cheques (lower(number));
CREATE INDEX cheques_status_idx ON cheques (status);
CREATE INDEX cheques_customer_idx ON cheques (customer_id);
