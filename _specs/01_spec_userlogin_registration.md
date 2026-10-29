# Spec 01: User Registration, Login and Per-User Customer Access

Status: Draft, open questions resolved, awaiting approval. Once approved, the implementation plan goes in `_plans/`.

## 1. Background

The project currently has no authentication. Every caller of the REST API (`/api/customers*`) and the AI agent (`/api/agent`) can read and modify all rows in the `customers` table.

This feature adds user registration and login, and ties every customer to the sales person who owns it. A logged-in user can only see and change their own customers, through the REST API, the AI agent and the UI.

## 2. Goals

- Register a new user. The role is `sales` by default.
- Log in and receive a token used to call protected endpoints.
- Associate each customer with exactly one user (the sales person).
- Restrict all customer CRUD to the logged-in user's own customers.
- Make the AI agent respect the same restriction.
- Deny (not leak) any attempt to access or change another user's customers.
- Document all new and changed endpoints in Swagger, and allow testing them there, including the "Authorize" flow.

## 3. Non-goals

- Admin or manager roles and cross-user visibility (only `sales` is used now; the `role` column leaves room for more).
- Password reset, email verification, refresh tokens, social login.
- Reassigning a customer to another user.

## 4. Data model

### 4.1 New `users` table

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | serial primary key | |
| `name` | text not null | |
| `email` | text not null, unique | Stored lower-cased; uniqueness is case-insensitive |
| `password_hash` | text not null | Hashed with bcrypt; plain text is never stored or returned |
| `role` | text not null default `'sales'` | Only `sales` is allowed for now (check constraint) |
| `created_at` | timestamptz not null default now() | |

### 4.2 Change to `customers`

- Add `user_id integer references users(user_id)` (the owning sales person).
- New customers always get `user_id` from the logged-in user. The client cannot set or override it.
- Migration of existing rows: add the column as nullable, insert a seed user (name `Seed Sales`, email `seed.sales@example.com`, role `sales`, with a bcrypt password hash that is documented/set by the migration script, not hard-coded in the app), assign all existing customers to it, then make `user_id` `NOT NULL`. The seed user's password must be changed or the account disabled before any production use.
- Add an index on `customers(user_id)`.

The repo has no migration tooling and does not create the `customers` table, so the SQL for these changes is delivered as a script in the repo (location decided in the plan) and applied manually.

## 5. Authentication

- Passwords are hashed with bcrypt.
- Login returns a signed JWT (HS256) with `sub` = `user_id` and `role`, expiring after a configurable time (default 8 hours).
- Clients send `Authorization: Bearer <token>`.
- New backend env vars: `JWT_SECRET` (required, no default; the server fails clearly if it is missing) and `JWT_EXPIRES_IN` (optional, default `8h`). Both go in `.env.example` and the README deploy table.
- An auth middleware validates the token and sets `req.user = { user_id, role }`.

## 6. API changes

All errors keep the existing shape `{ "error": "message" }`.

### 6.1 New endpoints (public)

**`POST /api/auth/register`**
- Body: `name`, `email`, `password` (all required). Email must be a valid format; password must be at least 8 characters.
- The role is always `sales`. Any `role` in the body is ignored.
- `201` returns `{ token, user: { user_id, name, email, role } }` (same shape as login; never the hash). The user is logged in immediately, with no separate login call needed.
- `400` for missing or invalid fields; `409` if the email is already registered.

**`POST /api/auth/login`**
- Body: `email`, `password`.
- `200` returns `{ token, user: { user_id, name, email, role } }`.
- `401` with the same generic message `Invalid email or password` for an unknown email or a wrong password.

### 6.2 New endpoint (protected)

**`GET /api/auth/me`**: returns the current user `{ user_id, name, email, role }`. `401` if the token is missing or invalid.

### 6.3 Changed endpoints (now protected)

All of these require a valid token and return `401` otherwise.

| Endpoint | New behaviour |
| --- | --- |
| `GET /api/customers` | Returns only the caller's customers. The `name` filter applies within them. |
| `GET /api/customers/:id` | `404` if the customer does not exist **or** belongs to another user. |
| `POST /api/customers` | Creates the customer with `user_id` = caller. |
| `PUT /api/customers/:id` | Updates only if owned by the caller; otherwise `404`. |
| `DELETE /api/customers/:id` | Deletes only if owned by the caller; otherwise `404`. |
| `POST /api/agent` | See section 7. |

Access control is enforced in the SQL layer (`WHERE user_id = $n` on every customer query in `src/db.js`), not only in route handlers, so no code path can read or change another user's rows. Returning `404` instead of `403` for other users' customers avoids revealing which ids exist. The response is identical to a non-existent id.

Responses include `user_id` on customer objects.

## 7. AI agent

- `POST /api/agent` requires authentication.
- `runAgent` receives the authenticated `user_id` and passes it to every tool handler in `src/agent.js`. The model never supplies or sees a user id as a tool input, so it cannot choose another user's data.
- Every tool (`get_all_customers`, `get_customer_by_name`, `add_customer`, `update_customer`, `delete_customer`) is scoped to that `user_id` through the same scoped `db` functions as the REST API.
- If the model asks to update or delete a customer id the user does not own, the tool returns "not found", exactly as for a missing id.
- The system prompt states that the assistant only has access to the logged-in user's customers and must not claim to see anything else.

## 8. Swagger documentation

Update `src/swagger.js` so that:
- A `bearerAuth` security scheme (HTTP bearer, JWT) is defined, which gives Swagger UI an **Authorize** button.
- All customer endpoints and `/api/agent` declare `security: [{ bearerAuth: [] }]`, and document the `401` (and `404` for non-owned) responses.
- New tags and schemas for **Auth**: register, login and me, with request and response schemas and examples (`RegisterRequest`, `LoginRequest`, `LoginResponse`, `User`).
- The `Customer` schema includes `user_id`; the create/update input schemas do not accept it.
- The swagger HTML keeps working on Vercel (CDN assets) and persists the authorization between page reloads.

Testing through Swagger: register (or login), copy the returned token into Authorize, then call the customer and agent endpoints as that user.

## 9. Frontend

- New login and registration screens (registering logs the user in directly); the existing customer UI and chat are shown only when logged in.
- `src/api.js` attaches the `Authorization` header; the token is kept in `localStorage`.
- On any `401` the token is cleared and the user returns to the login screen.
- A logout button and display of the current user's name.
- Customer list, form and chat behave as before, but show only the user's own data.

## 10. Decisions

1. Existing ownerless `customers` rows are assigned to a seed user (section 4.2).
2. The token is stored in `localStorage`. This is exposed to XSS, but accepted for this project.
3. Registration returns a token immediately (section 6.1).

## 11. Acceptance criteria

1. A new user can register, gets role `sales` and a working token in the same response; a `role` sent in the body is ignored.
2. Registering a duplicate email (any letter case) returns `409`.
3. Login with correct credentials returns a token; wrong password or unknown email returns the same `401`.
4. Every customer and agent endpoint returns `401` without a valid token.
5. User A creates customers; user B's `GET /api/customers` does not include them.
6. User B calling GET, PUT or DELETE on user A's customer id gets `404`, and A's data is unchanged.
7. A customer created by user A always has `user_id` = A, even if the body contains a different `user_id`.
8. Asking the agent to list, find, update or delete customers only ever affects the logged-in user's customers; asking about another user's customers returns "not found" style answers.
9. Swagger UI shows the Auth endpoints and an Authorize button, and the full flow (register, login, authorize, CRUD, agent) can be run from it.
10. The frontend requires login, shows only the user's customers, and logs out cleanly on token expiry.
11. After migration, every pre-existing customer belongs to the seed user and `customers.user_id` is `NOT NULL`.
12. `.env.example`, `README.md` and `CLAUDE.md` reflect the new env vars and the auth/ownership rules.
