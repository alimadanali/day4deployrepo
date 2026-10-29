# Plan 02: Admin Login and Users Dashboard

Implements `_specs/02_spec_admin_login.md` (approved). Execute the steps in order. Each step leaves the app runnable, so it can be committed on its own.

Prerequisite: the working tree is clean and committed (workflow rule in `CLAUDE.md`). Do the work on a feature branch, e.g. `feature/admin-dashboard`.

There is no test framework in the repo. Verification is manual (curl / Swagger UI / browser).

## Step 1: Database migration script

New file `backend/db/002_admin_role.sql`, applied manually: `psql "$DATABASE_URL" -v admin_hash="<bcrypt hash>" -f db/002_admin_role.sql`. In a single transaction:

1. `ALTER TABLE users DROP CONSTRAINT users_role_check` (the name Postgres gave the inline check in `001`), then `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('sales', 'admin'))`.
2. Insert the default admin: `INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', 'admin@admin.com', :'admin_hash', 'admin') ON CONFLICT DO NOTHING` (the unique index is on `lower(email)`, so the conflict target is omitted to cover it).

Generate the hash for the initial password `12345678` with the existing helper: `node db/hash-password.js 12345678`. Add the migration usage line to the script header, like `001`.

Verify: `SELECT email, role FROM users WHERE role = 'admin'` returns one row; running the script twice still returns one row.

## Step 2: Data layer (`backend/src/db.js`)

- `listUsersWithCustomerCounts()`: `SELECT u.user_id, u.name, u.email, u.role, u.created_at, count(c.customer_id)::int AS customer_count FROM users u LEFT JOIN customers c ON c.user_id = u.user_id GROUP BY u.user_id ORDER BY u.created_at ASC`. Never selects `password_hash`.
- `getStats()`: one query returning `total_users`, `total_sales_users`, `total_customers` as integers.
- Both are counts-only aggregates and have a short comment saying they are the intentional exception to per-user scoping.
- Check `getUser(id)` returns `role` (needed by `requireAdmin`); add it to the selected columns if missing.

## Step 3: Auth middleware (`backend/src/auth.js`)

- `requireSales`: after `requireAuth`, responds `403 { error: 'Sales access required' }` unless `req.user.role === 'sales'`.
- `requireAdmin`: after `requireAuth`, loads the user with `getUser(req.user.user_id)` and responds `403 { error: 'Admin access required' }` unless the row exists with `role === 'admin'` (decision 1 in the spec: re-checked against the database on every request, so a demoted or deleted admin loses access immediately). Pass errors from `getUser` to `next`.
- `auth.js` currently imports nothing from `db.js`; import `getUser` from there (no cycle: `db.js` does not import `auth.js`).
- `signToken` and `requireAuth` are unchanged; `signToken` already puts `role` in the token.

## Step 4: Routes (`backend/src/app.js`)

- Change `app.use(['/api/customers', '/api/agent'], requireAuth)` to also apply `requireSales` after `requireAuth`, so admin tokens get `403` on customer and agent endpoints.
- Add, after the auth routes:
  - `GET /api/admin/users`: `requireAuth, requireAdmin`, returns `db.listUsersWithCustomerCounts()`.
  - `GET /api/admin/stats`: same guards, returns `db.getStats()`.
  - Both wrapped with the `wrap` helper.
- Login (`/api/auth/login`), register and `/api/auth/me` need no change: the admin logs in through `/api/auth/login`, and the response `user.role` already comes from the row. Confirm register still hard-codes the `sales` role (a `role` in the body is ignored).

Verify with curl: log in as `admin@admin.com`; `GET /api/admin/users` with the admin token returns users with counts; the same call with a sales token returns `403` and with no token `401`; `GET /api/customers` with the admin token returns `403`.

## Step 5: Swagger (`backend/src/swagger.js`)

- Add the **Admin** tag and paths `GET /api/admin/users` and `GET /api/admin/stats`, each with `security: [{ bearerAuth: [] }]` and `401` / `403` responses.
- Add schemas `AdminUserSummary` (user fields plus `customer_count`, `created_at`) and `AdminStats`.
- Change the `User` schema `role` enum to `[sales, admin]`.
- Add a `403` response ("admin token") to each customer path and `/api/agent`.
- Mention the default admin email in the login operation description (not the password).

Verify at `/swagger`: log in as the admin, Authorize with the token, run `/api/admin/users`.

## Step 6: Frontend

- `src/api.js`: add `getAdminUsers()` and `getAdminStats()` through the existing `request` wrapper. Login, logout and `me` are unchanged.
- New `src/AdminDashboard.jsx`:
  - Fetches users and stats on mount; shows loading and error states with the existing `alert` class.
  - Summary cards: total users, total customers.
  - Table: name, email, role, customer count, joined date. Search box (name or email, client-side) and a sortable customer-count column (toggle asc/desc).
- `App.jsx`: after login or session restore (`api.me()`), choose the view from `user.role`. `admin` renders `AdminDashboard` and none of the customer list, form or `Chat`; `sales` renders what exists today. Keep the topbar user name and Logout for both. Make sure the customer fetch effect only runs for sales users, so an admin never triggers the `403` from `/api/customers`.
- Registration stays sales-only. `AuthForm.jsx` needs no change.
- `src/styles.css`: small additions for the stat cards and the table (reuse the existing `card` and table styles).

Verify in the browser: log in as `admin@admin.com` / `12345678` and see the dashboard with admins included and correct counts; log out and log in as a sales user and see the customer view; add a customer as the sales user and confirm the admin's count increases after a refresh.

## Step 7: Docs

- `README.md`: add the `002` migration step after `001` (with the `hash-password.js` command), document the default admin `admin@admin.com` with initial password `12345678`, and a warning to change it before production use.
- `CLAUDE.md`: mention the `admin` role and that admins sign in through the normal login; the `/api/admin/*` routes with `requireAdmin` (DB re-check); `requireSales` on customer and agent routes; the counts-only functions in `db.js` as the one documented exception to "never add an unscoped customer query"; and add `/api/admin/*` to the list of places that must stay in sync. Add `AdminDashboard.jsx` to the frontend description.
- `.env.example`: no change (no new env vars).

## Step 8: Final verification against the spec's acceptance criteria

Walk through criteria 1 to 12 with the admin and two sales users, using Swagger or curl and the browser. In particular: the migration is idempotent; a wrong admin password gives the same `401`; a sales token gets `403` on `/api/admin/*`; an admin token gets `403` on `/api/customers*` and `/api/agent`; registering with `role: "admin"` creates a sales user; `customer_count` is `0` for users with no customers and `password_hash` never appears in responses. Then commit, push the branch and open a PR.

## Risks and notes

- **Deploy order:** run `002` before deploying the new backend. The old backend keeps working after the migration (it only widens the role constraint and adds one row).
- **Weak default password:** `12345678` is documented and must be changed. There is no change-password feature (non-goal), so change it by generating a new hash with `hash-password.js` and updating `users.password_hash` manually.
- **Hidden admin in lists:** admin rows own no customers and show a count of `0`; this is expected.
- **Per-request DB lookup:** `requireAdmin` adds one primary-key query to each admin request; acceptable at this scale and within the `max: 3` pool.
- **Existing sessions:** any sales token issued before the change still works, because it already carries `role: 'sales'`.
