-- Adds deals: sales opportunities with a customer.
-- Usage: psql "$DATABASE_URL" -f db/003_deals.sql
-- Safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS deals (
  deal_id             serial PRIMARY KEY,
  customer_id         integer NOT NULL REFERENCES customers (customer_id) ON DELETE CASCADE,
  user_id             integer NOT NULL REFERENCES users (user_id),
  title               text NOT NULL,
  amount              numeric(14,2) NOT NULL CHECK (amount >= 0),
  stage               text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead', 'qualified', 'proposal', 'won', 'lost')),
  expected_close_date date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deals_user_id_idx ON deals (user_id);
CREATE INDEX IF NOT EXISTS deals_customer_id_idx ON deals (customer_id);

COMMIT;
