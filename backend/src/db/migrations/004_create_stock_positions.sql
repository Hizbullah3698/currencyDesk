CREATE TABLE stock_positions (
  code       text PRIMARY KEY,
  available  numeric(18,4) NOT NULL DEFAULT 0,
  avg_cost   numeric(18,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
