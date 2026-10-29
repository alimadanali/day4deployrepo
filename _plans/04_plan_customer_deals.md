# Plan 04: Customer Deals

Implements `_specs/04_spec_customer_deals.md` (approved). Execute the steps in order. Each step leaves the app runnable, so it can be committed on its own.

Prerequisite: the working tree is clean and committed (workflow rule in `CLAUDE.md`). Do the work on a feature branch, e.g. `feature/customer-deals`.

There is no test framework in the repo. Verification is manual (curl / Swagger UI / browser).

## Step 1: Database migration script

New file `backend/db/003_deals.sql`, applied manually with `psql "$DATABASE_URL" -f db/003_deals.sql` (no password variable needed). One transaction, safe to re-run:

1. `CREATE TABLE IF NOT EXISTS deals (deal_id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers (customer_id) ON DELETE CASCADE, user_id integer NOT NULL REFERENCES users (user_id), title text NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount >= 0), stage text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','qualified','proposal','won','lost')), expected_close_date date, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`.
2. `CREATE INDEX IF NOT EXISTS deals_user_id_idx ON deals (user_id)` and `deals_customer_id_idx ON deals (customer_id)`.

Apply it to the database in `backend/.env` the same way `002` was applied (`psql` is not installed on this machine, so run the same statements through a small Node script using `pg`; the SQL file stays the source of truth).

Verify: `\d deals` shows the constraints, and a second run changes nothing.

## Step 2: Data layer (`backend/src/db.js`)

Add a deals section after the customer functions, each function taking `userId` first and filtering `user_id`:

- `DEAL_COLS`: `deal_id, customer_id, title, amount::float8 AS amount, stage, to_char(expected_close_date, 'YYYY-MM-DD') AS expected_close_date, created_at, updated_at`. The cast returns `amount` as a number and `to_char` avoids time-zone shifts of the date.
- `listDeals(userId, stage)`: joins `customers` for `customer_name`, optional `AND d.stage = $2`, ordered `created_at DESC, deal_id DESC`.
- `listCustomerDeals(userId, customerId)`: same order, `WHERE user_id = $1 AND customer_id = $2`. Returns `[]` for an unowned customer, so the route first checks `getCustomer(userId, id)` to give `404`.
- `getDeal(userId, id)`.
- `createDeal(userId, customerId, { title, amount, stage, expected_close_date })`: one statement, `INSERT INTO deals (customer_id, user_id, ...) SELECT customer_id, user_id, $3, ... FROM customers WHERE customer_id = $2 AND user_id = $1 RETURNING ...`. Zero rows means not owned (the route returns `404`).
- `updateDeal(userId, id, fields)`: builds the `SET` list from the keys actually present in `fields` (so `expected_close_date: null` clears it, which `COALESCE` cannot do), always sets `updated_at = now()`, and filters `user_id = $1 AND deal_id = $2`. If no updatable key is present it just returns the current deal.
- `deleteDeal(userId, id)`.

## Step 3: Validation and routes (`backend/src/app.js`)

- A small `validateDeal(body, { partial })` helper returning `{ error }` or the cleaned fields, covering the rules in spec section 5: trimmed title 1 to 200 characters; amount a finite number, `>= 0`, `<= 999999999999.99`, at most 2 decimal places (check `Math.round(a * 100) === a * 100` after a tolerance, or compare `Number(a.toFixed(2)) === a`); stage in the five values (default `lead` on create); `expected_close_date` empty/`null` or a real `YYYY-MM-DD` calendar date (parse and compare the round-tripped string). Only `title`, `amount`, `stage` and `expected_close_date` are read from the body, so `customer_id`, `user_id` and `deal_id` are ignored.
- Change the guard to `app.use(['/api/customers', '/api/deals', '/api/agent'], requireAuth, requireSales)` so admins get `403` and no token `401`.
- Add, near the customer routes:
  - `GET /api/customers/:id/deals` and `POST /api/customers/:id/deals` (after `parseId`; `404 Customer not found` for an unowned customer; `201` on create). These two paths do not collide with `/api/customers/export` or `/api/customers/:id` (different segment counts).
  - `GET /api/deals` (optional `?stage=`, validated against the five values, `400` otherwise), `GET /api/deals/:id`, `PUT /api/deals/:id`, `DELETE /api/deals/:id`, all `404 Deal not found` when missing or not owned.
- All handlers use `wrap` and pass `req.user.user_id`.

Verify with curl using two sales tokens: create, list, update (including clearing the date), delete; user B gets `404` on user A's deal and customer ids; invalid input returns `400`; no token `401`; admin token `403`; deleting a customer removes its deals.

## Step 4: Swagger (`backend/src/swagger.js`)

- Add the **Deals** tag and schemas `Deal`, `DealInput` (title, amount required; stage, expected_close_date optional) and `DealUpdate`, with the `stage` enum and the brochure example.
- Add the six paths with `security: secured` and `401`, `403: notSales`, `404` (not found or not owned) responses; `GET /api/deals` documents the `stage` query parameter.
- Keep the file free of unescaped quotes in strings (the apostrophe in a description once crashed startup), and check `node -e "import('./src/swagger.js')"` loads.

Verify at `/swagger`: Authorize with a sales token and run the flow.

## Step 5: Frontend

- `src/api.js`: add `listCustomerDeals(customerId)`, `createDeal(customerId, deal)`, `updateDeal(id, fields)`, `removeDeal(id)` through the existing `request` wrapper.
- New `src/money.js` (or a small helper in `Deals.jsx`): `formatINR(amount)` using `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` with `maximumFractionDigits: 0` for whole rupees and 2 when the amount has paise; and `STAGES` (value, label, colour class).
- New `src/Deals.jsx` (modal panel, reusing `modal-backdrop` and `modal` styles, wider):
  - Props: `customer`, `onClose`, `onChanged` (so the customer view can refresh its deal counts if needed).
  - Loads the customer's deals; table with title, amount, stage `<select>` (calls `updateDeal` on change, optimistic with rollback on error), expected close date, Edit and Delete (confirm).
  - Totals line: open pipeline (lead + qualified + proposal), won, lost, computed client-side.
  - **Add deal** and **Edit** open `DealForm` (below).
- New `src/DealForm.jsx`, same pattern as `CustomerForm.jsx`: title, amount (number input, `min=0`, `step=0.01`), stage select, expected close date (`type="date"`); server errors shown in the `alert` class.
- `App.jsx` (`Customers`): add a **Deals** button to each row's actions and a `dealsFor` state that mounts `Deals`. Change the delete confirmation to mention that the customer's deals will also be deleted. To show the count, either fetch `listCustomerDeals` when the delete is clicked, or add a cheap `deal_count` to the customer list (see risks); the first option keeps the customer API unchanged and is the plan.
- `styles.css`: stage badges, a wider modal variant, and totals styling.

Verify in the browser as a sales user: add the "Brochure printing - Q4" deal at ₹1,50,000 (see `₹1,50,000`), change the stage in the table, edit, delete, and check the totals. Delete a customer with deals and check the confirmation text and that the deals are gone. Log in as a second user to confirm no deals leak. Log in as admin: no change to the dashboard.

## Step 6: Docs

- `README.md`: add the `003` migration step after `002`, and a short note on deals.
- `CLAUDE.md`: document the `deals` table, that every deal query is scoped by `user_id` and `createDeal` copies it from the customer in one statement, that deal routes are behind `requireSales`, and that cascade deletes remove a customer's deals. Mention `Deals.jsx` and `DealForm.jsx` in the frontend description.

## Step 7: Final verification against the spec's acceptance criteria

Walk through criteria 1 to 11 with two sales users and the admin, using Swagger or curl and the browser. In particular: validation errors for stage, amount, title and date; cross-user `404`s on both deal and customer ids; `?stage=` filtering; clearing the date with `null`; `updated_at` changes on update; cascade on customer delete; admin `403`. Then commit, merge to `main` and push when you ask.

## Risks and notes

- **Deploy order:** run `003` before deploying the new backend; the old backend ignores the new table, so it is safe to migrate first.
- **Amount precision:** `numeric(14,2)` cast to `float8` is exact for amounts up to the 999,999,999,999.99 limit within double precision for 2 decimals at this magnitude (about 15 significant digits), which is the reason for that cap.
- **Date handling:** `expected_close_date` is formatted by Postgres (`to_char`), never through a JS `Date`, so there are no time-zone off-by-one errors.
- **Delete confirmation count:** fetching the deals on delete adds one request; a `deal_count` on the customer list is a possible later optimisation but would change the customer API in three places.
- **Agent and admin:** unchanged by this plan, as decided in the spec.
