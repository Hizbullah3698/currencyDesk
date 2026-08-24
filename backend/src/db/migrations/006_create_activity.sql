CREATE TABLE activity (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  text NOT NULL CHECK (type IN ('purchase','sale','receive','pay')),
  currency              text,
  customer_id           text REFERENCES accounts(id),
  customer_name         text NOT NULL,
  amount                numeric(18,4) NOT NULL,
  rate                  numeric(18,6),
  pkr_value             numeric(18,2) NOT NULL,
  cost                  numeric(18,2),
  margin                numeric(18,2),
  method                text NOT NULL CHECK (method IN ('Cash','Bank','Cheque','Credit')),
  paid_now              numeric(18,2),
  outstanding           numeric(18,2),
  cheque_held           boolean NOT NULL DEFAULT false,
  cheque_id             uuid REFERENCES cheques(id),
  settlement_account_id text REFERENCES accounts(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX activity_customer_idx ON activity (customer_id);
CREATE INDEX activity_created_at_idx ON activity (created_at);
CREATE INDEX activity_type_idx ON activity (type);
