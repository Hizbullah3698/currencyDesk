CREATE TABLE accounts (
  id                 text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type               text NOT NULL CHECK (type IN
                       ('Customer','Bank','Cash','Currency Stock','Expense',
                        'Employee','Income','Capital','Payable')),
  name               text NOT NULL,
  is_system          boolean NOT NULL DEFAULT false,
  notes              text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL,

  receivable         numeric(18,2) NOT NULL DEFAULT 0,
  payable            numeric(18,2) NOT NULL DEFAULT 0,
  opening_receivable numeric(18,2) NOT NULL DEFAULT 0,
  opening_payable    numeric(18,2) NOT NULL DEFAULT 0,
  opening_posted     boolean NOT NULL DEFAULT false,

  phone              text,
  city               text,
  bank_name          text,
  account_no         text,
  code               text,
  category           text,
  designation        text,
  monthly_salary     numeric(18,2),

  type_changed_from  text,
  type_changed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  type_changed_at    timestamptz,

  archived           boolean NOT NULL DEFAULT false,
  archived_at        timestamptz,
  archived_by        uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX accounts_name_lower_idx ON accounts (lower(name));
CREATE INDEX accounts_type_idx ON accounts (type);
