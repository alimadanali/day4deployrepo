# Plan 01: User Registration, Login and Per-User Customer Access

Implements `_specs/01_spec_userlogin_registration.md`. Execute the steps in order. Each step leaves the app in a runnable state, so it can be committed on its own.

Prerequisite: the current branch is committed (spec-driven workflow rule in `CLAUDE.md`). Do the work on a feature branch, e.g. `feature/user-auth`.

There is no test framework in the repo. Verification in each step is manual (curl / Swagger UI / browser). Adding a test framework is out of scope.

## Step 1: Database migration script

New file `backend/db/001_users_and_ownership.sql` (the repo has no migration tooling, so it is applied manually with `psql "$DATABASE_URL" -f ...`). In a single transaction:

1. `CREATE TABLE users (user_id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL, password_hash text NOT NULL, role text NOT NULL DEFAULT 'sales' CHECK (role = 'sales'), created_at timestamptz NOT NULL DEFAULT now())`.
2. `CREATE UNIQUE INDEX users_email_key ON users (lower(email))` (case-insensitive uniqueness; the app also stores emails lower-cased).
3. `ALTER TABLE customers ADD COLUMN user_id integer REFERENCES users(user_id)`.
4. Insert the seed user (`Seed Sales`, `seed.sales@example.com`). The bcrypt hash cannot be computed in SQL portably, so the script takes it as a psql variable: `psql -v seed_hash="$HASH" -f ...`. Generate the hash with a small helper `backend/db/hash-password.js` (`node db/hash-password.js <password>`, uses the app's bcrypt dependency).
5. `UPDATE customers SET user_id = <seed user id> WHERE user_id IS NULL`.
6. `ALTER TABLE customers ALTER COLUMN user_id SET NOT NULL`, then `CREATE INDEX customers_user_id_idx ON customers (user_id)`.

Verify: `SELECT count(*) FROM customers WHERE user_id IS NULL` is 0, and the seed user can be selected. Note in the README that this script must be applied before deploying the new backend.

## Step 2: Dependencies and config (backend)

- `cd backend && npm install bcryptjs jsonwebtoken` (bcryptjs is pure JS, so it avoids native-build problems on Vercel).
- `backend/.env.example`: add `JWT_SECRET=` and `JWT_EXPIRES_IN=8h`.
- `README.md`: add both vars to the backend deploy table, and add the migration step before "Deploy to Vercel".

## Step 3: Auth module (backend)

New `backend/src/auth.js`:
- `hashPassword`, `verifyPassword` (bcryptjs).
- `signToken(user)`: HS256, payload `{ sub: user_id, role }`, `expiresIn` from `JWT_EXPIRES_IN` (default `8h`). Throws a clear 500 error if `JWT_SECRET` is unset (checked when signing and verifying, not at import, so Swagger still loads without it).
- `requireAuth` middleware: reads `Authorization: Bearer <token>`, verifies it, sets `req.user = { user_id, role }`, otherwise responds `401 { error }`. It must not look the user up per request beyond the token, but `/api/auth/me` does fetch the user row so a deleted user gets `401`.

## Step 4: Data layer (backend, `src/db.js`)

- Add user functions: `createUser({ name, email, password_hash })` (lower-cases the email; maps the unique-violation error `23505` to a 409 error), `findUserByEmail(email)` (includes hash, for login only), `getUser(id)` (no hash).
- Scope every customer function by owner, adding `userId` as the first parameter and `AND user_id = $n` to each WHERE clause: `listCustomers`, `getCustomer`, `findCustomersByName`, `updateCustomer`, `deleteCustomer`. `createCustomer` inserts `user_id`.
- Add `user_id` to `COLS`.
- Because every customer query requires the owner, nothing can read or write unscoped rows by accident.

## Step 5: Routes (backend, `src/app.js`)

- Add `POST /api/auth/register` and `POST /api/auth/login` (public) and `GET /api/auth/me` (protected), as specified in spec section 6.
  - Register validates `name`, `email` (simple format check), `password` (>= 8 chars), ignores any `role`, creates the user and returns `201 { token, user }`.
  - Login returns the same shape, with the single generic `401 Invalid email or password` for both unknown email and wrong password. Run a bcrypt compare against a dummy hash for unknown emails to keep timing similar.
- Apply `requireAuth` to `/api/customers` (via `app.use('/api/customers', requireAuth)`) and to `/api/agent`, placed before those route definitions.
- Pass `req.user.user_id` to every `db` customer call. In `POST /api/customers`, build the insert from `customer_name` and `email` only, so a `user_id` in the body is ignored.
- Other users' customers return the existing `404 Customer not found` (falls out of the scoped queries).
- The existing error handler already returns `{ error }` with `err.status`.

Verify with curl: register, call customers with no token (401), with token (200).

## Step 6: Agent (backend, `src/agent.js`)

- Change `runAgent(message, history, userId)` and make each handler take `(input, userId)`: `get_all_customers: (_, uid) => db.listCustomers(uid)` and so on. Tool input schemas are unchanged, so the model never sees or sets a user id.
- Call handlers as `handlers[block.name](block.input, userId)`.
- Update `SYSTEM` to say the assistant only has access to the logged-in user's customers.
- `app.js` passes `req.user.user_id`.

Verify: as user B ask the agent to delete a customer id owned by A and confirm it reports not found and A's row remains.

## Step 7: Swagger (`src/swagger.js`)

- Add `components.securitySchemes.bearerAuth` (`type: http, scheme: bearer, bearerFormat: JWT`) and schemas `User`, `RegisterRequest`, `LoginRequest`, `AuthResponse`. Add `user_id` to `customer`.
- Add the `Auth` tag and the three auth paths. Register and login declare `security: []`; `me` declares bearer auth.
- Add `security: [{ bearerAuth: [] }]` plus `401` responses to every customer path and `/api/agent`; keep the `404` descriptions, now noting "or not owned by the caller".
- In `swaggerHtml`, pass `persistAuthorization: true` to `SwaggerUIBundle`.

Verify in the browser at `/swagger`: register, click Authorize with the token, run CRUD and the agent.

## Step 8: Frontend

- `src/api.js`: store the token in `localStorage` (`auth_token`); `request` adds `Authorization: Bearer ...` when a token exists; on a `401` response clear the token and call a registered `onUnauthorized` callback. Add `register`, `login`, `me`, and `logout`.
- New `src/AuthForm.jsx`: one component toggling between Login and Register (name field only for register), shows API errors, and on success stores the token and passes the user to `App`.
- `App.jsx`: hold `user` state; on load, if a token exists call `api.me()` to restore the session (otherwise show `AuthForm`). Show the user's name and a Logout button in the topbar. Only mount the customer list and `Chat` when logged in. Reset `customers` and chat state on logout so one user's data never shows for the next.
- `styles.css`: minimal styles for the auth form and topbar user area, reusing the existing `card`, `btn` and `alert` classes.

Verify in the browser: register, see an empty list, add customers; log out and register a second user to confirm an empty list; expire/clear the token and confirm the redirect to login.

## Step 9: Docs

- Update `CLAUDE.md`: add auth/ownership rules (all customer SQL must be scoped by `user_id`; the agent gets the user id from the server, never from the model), the new env vars, the migration script, and the new `auth.js`. Update the "three places must stay in sync" note to include the auth routes.
- Confirm `README.md` and `.env.example` changes from Step 2.

## Step 10: Final verification against the spec's acceptance criteria

Walk through criteria 1 to 12 with two registered users, using Swagger or curl. In particular: duplicate email in a different letter case returns 409, a `user_id` in the create body is ignored, cross-user GET/PUT/DELETE return 404 and leave data unchanged, and the agent is scoped. Then commit, push the branch and open a PR.

## Risks and notes

- **Deploy order:** run the migration before deploying the new backend, otherwise queries on `user_id` fail. The old backend code keeps working after the migration (the extra `NOT NULL` column breaks its inserts, so deploy promptly).
- **Seed user password:** set a real password through `hash-password.js`, and change it or disable the account before production use.
- **`JWT_SECRET`:** must be set on Vercel for the backend project, or auth endpoints return a 500 with a clear message.
- **Pool SSL / Vercel:** no changes needed; `bcryptjs` and `jsonwebtoken` are pure JS.
