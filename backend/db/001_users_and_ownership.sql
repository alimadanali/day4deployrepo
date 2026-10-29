-- Adds users and per-user ownership of customers.
-- Usage: psql "$DATABASE_URL" -v seed_hash="<bcrypt hash>" -f db/001_users_and_ownership.sql
-- Generate the hash with: node db/hash-password.js <password>
BEGIN;

CREATE TABLE users (
  user_id       serial PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'sales' CHECK (role = 'sales'),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

ALTER TABLE customers ADD COLUMN user_id integer REFERENCES users (user_id);

-- Existing customers have no owner: assign them to a seed user.
-- Change this account's password (or disable it) before production use.
INSERT INTO users (name, email, password_hash)
VALUES ('Seed Sales', 'seed.sales@example.com', :'seed_hash');

UPDATE customers
SET user_id = (SELECT user_id FROM users WHERE email = 'seed.sales@example.com')
WHERE user_id IS NULL;

ALTER TABLE customers ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX customers_user_id_idx ON customers (user_id);

COMMIT;
