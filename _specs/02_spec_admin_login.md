# Spec 02: Admin Login and Users Dashboard

Status: Approved. Implementation plan: `_plans/02_plan_admin_login.md`.

## 1. Background

Spec 01 added registration and login. Every registered user is a `sales` user who can only see their own customers. There is no way to see who uses the application or how much each user has.

This feature adds an **admin** account, which signs in through the same login screen as sales users but gets a separate admin experience, and a dashboard that lists all application users together with the number of customers each one owns.

## 2. Goals

- Admin sign-in through the same login screen and endpoint as sales users; the account's role decides which view is shown.
- A default admin user with email `admin@admin.com`.
- An admin dashboard listing all users of the application and the number of customers associated with each.
- Admin endpoints are reachable only with an admin token. Sales tokens get `403`.
- Admin tokens cannot be used on sales endpoints, and the reverse.
- Document the new endpoints in Swagger.

## 3. Non-goals

- Admin registration through the API or UI. The admin is created by the migration only.
- Viewing, editing or deleting customers, or editing or deleting users, as admin. The dashboard is read-only and shows counts, not customer data.
- Admin password reset or change UI (the password is changed manually, see 4.2).
- Multiple admins, permission levels, audit logging.
- Changing the existing customer scoping rules from Spec 01.

## 4. Data model

### 4.1 `users` table

No new columns. Spec 01 left room in `role`; this spec extends it:

- Change the `role` check constraint from `('sales')` to `('sales', 'admin')`.
- The admin is a row in `users` with `role = 'admin'`, so it reuses `password_hash`, bcrypt and JWT handling.
- Admin rows own no customers (the dashboard shows 0).

### 4.2 Default admin

- The migration inserts one user: name `Admin`, email `admin@admin.com`, role `admin`.
- The initial password is `12345678`. The migration stores only its bcrypt hash (never the plain text in app code); the README documents the initial password. It is weak and must be changed before any production use.
- The insert is idempotent (`ON CONFLICT (email) DO NOTHING`).
- The SQL is delivered as a script in `backend/db/` (e.g. `002_admin_role.sql`) and applied manually with psql.

## 5. Authentication

- Admin and sales users share `POST /api/auth/login` (unchanged contract). The response already includes `user.role`, and the token carries `role: 'admin'` for the admin. Same JWT mechanism (HS256, `JWT_SECRET`, `JWT_EXPIRES_IN`).
- `requireAuth` keeps working as is. A new `requireAdmin` middleware runs after it and returns `403` if the user is not an admin. A new `requireSales` does the same for sales.
- Role separation:
  - The customer routes and `/api/agent` require `role = 'sales'`. An admin token gets `403` there, since admins own no customers.
  - The `/api/admin/*` routes require `role = 'admin'`. A sales token gets `403`.
  - `POST /api/auth/register` still always creates `sales` users; a `role` in the body is ignored.
- `requireAdmin` re-checks the role in the database on every request (see decision 1).

## 6. API changes

All errors keep the shape `{ "error": "message" }`.

### 6.1 New endpoints

No new login endpoint: the admin uses `POST /api/auth/login`.

**`GET /api/admin/users`** (admin only)
- Returns all users, including admins, ordered by `created_at` ascending:

```json
[
  { "user_id": 2, "name": "Jane Sales", "email": "jane@example.com", "role": "sales", "customer_count": 12, "created_at": "2026-10-01T09:00:00Z" }
]
```

- `customer_count` is computed in SQL (`LEFT JOIN customers ... GROUP BY`), so users with no customers show `0`.
- Never returns `password_hash`.
- `401` without a valid token; `403` for a sales token.

**`GET /api/admin/stats`** (admin only), optional summary for the dashboard header
- Returns `{ total_users, total_sales_users, total_customers }`.
- Same auth rules as above.

### 6.2 Changed behaviour

| Endpoint | Change |
| --- | --- |
| `GET /api/auth/me` | Works for both roles; returns the current user including `role`. |
| `/api/customers*`, `/api/agent` | Require `role = 'sales'`; admin tokens get `403`. |

New queries (`listUsersWithCustomerCounts`, `getStats`) live in `src/db.js`, parameterized like the rest. They are the only unscoped customer aggregates and return counts only, never customer rows. This is a deliberate, documented exception to "never add an unscoped customer query" in CLAUDE.md, and CLAUDE.md is updated to say so.

## 7. AI agent

No change. The agent stays sales-only, and an admin token is rejected by `/api/agent` (section 6.2).

## 8. Swagger documentation

Update `src/swagger.js` so that:
- A new **Admin** tag documents `GET /api/admin/users` and `GET /api/admin/stats`.
- The admin endpoints declare `security: [{ bearerAuth: [] }]` and document `401` and `403`.
- New schemas: `AdminUserSummary` (user fields plus `customer_count`), `AdminStats`.
- The `User` schema's `role` enum becomes `[sales, admin]`.
- The customer and agent endpoints also document `403` for admin tokens.
- The login description mentions the default admin email.

Testing through Swagger: call `/api/auth/login` as the admin, copy the token into Authorize, then call `/api/admin/users`.

## 9. Frontend

- No new login screen. The existing login form is used for both roles; the admin signs in with `admin@admin.com`. Registration remains sales-only.
- After login, the app picks the view from `user.role`. For an admin it renders the **Admin Dashboard** instead of the customer view and chat:
  - Summary cards: total users, total customers.
  - A table of users: name, email, role, customer count, joined date. Sortable by customer count and searchable by name or email (client-side).
  - Logout button and the admin's name.
- The sales UI is unchanged and is never shown to an admin, and the dashboard is never shown to a sales user.
- On session restore, `App.jsx` calls `/api/auth/me` and picks the view from `role`.
- Any `401` clears the token and returns to the login screen, as today.
- `src/api.js` gets the admin calls (`getAdminUsers`, `getAdminStats`) through the same fetch wrapper.

## 10. Decisions and open questions

Proposed decisions (confirm at approval):

1. **Role check on every admin request.** The role is taken from the token, so an admin who is demoted or deleted would otherwise keep access until expiry. `requireAdmin` therefore loads the user and confirms `role = 'admin'` on each request (one cheap query by primary key).
2. **Admin lives in `users`**, not a separate table, to reuse auth code and the existing `role` column.
3. **Admin sees counts only**, not customer details, keeping the privacy boundary from Spec 01.
4. **Initial admin password** is `12345678` (decided), stored as a bcrypt hash by the migration and documented in the README.
5. **Same login** for admin and sales (decided); the role selects the view.
6. **Dashboard lists admins as well as sales users** (decided), with the role shown.

Open questions: none.

## 11. Acceptance criteria

1. After the migration, `admin@admin.com` exists with role `admin`, and re-running the migration does not duplicate it.
2. `POST /api/auth/login` with `admin@admin.com` / `12345678` returns a token and `user.role = 'admin'`.
3. A wrong admin password returns the same `401 Invalid email or password` as for any user.
4. Sales login behaviour from Spec 01 is unchanged.
5. `GET /api/admin/users` without a token returns `401`; with a sales token returns `403`.
6. `GET /api/admin/users` with an admin token returns every user with a correct `customer_count` (including `0`), and never includes `password_hash`.
7. After a sales user adds or deletes a customer, the count for that user changes accordingly on the next request.
8. An admin token calling `/api/customers*` or `/api/agent` returns `403`.
9. Registering through `/api/auth/register` can never produce an admin, even if `role: "admin"` is sent.
10. Logging in on the existing form as admin shows the dashboard with the user table (admins included) and counts; a sales login still shows the customer view; each role never sees the other's screens.
11. Swagger UI documents the Admin endpoints and the full flow (login as admin, authorize, list users) works from it.
12. `README.md` (migration step, default admin, password note), `.env.example` if affected, and `CLAUDE.md` (admin role, the counts-only exception to scoping) are updated.
