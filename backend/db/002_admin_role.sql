-- Adds the admin role and the default admin user (admin@admin.com).
-- Usage: psql "$DATABASE_URL" -v admin_hash="<bcrypt hash>" -f db/002_admin_role.sql
-- Generate the hash with: node db/hash-password.js <password>
-- Safe to run more than once. Change the admin's password before production use.
BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('sales', 'admin'));

INSERT INTO users (name, email, password_hash, role)
VALUES ('Admin', 'admin@admin.com', :'admin_hash', 'admin')
ON CONFLICT DO NOTHING;

COMMIT;
