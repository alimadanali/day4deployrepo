# Customer Manager

- `backend/` - Express REST API, Swagger UI at `/swagger`, Postgres, Claude-powered `/api/agent`
- `frontend/` - React + Vite UI (customer CRUD + chat assistant)

## Local development

```
cd backend  && cp .env.example .env && npm install && npm start   # http://localhost:3001
cd frontend && cp .env.example .env && npm install && npm run dev  # http://localhost:5173
```

## Database migration

Apply before running or deploying the auth-enabled backend (creates `users`, adds `customers.user_id`, assigns existing customers to a seed user `seed.sales@example.com`):

```
cd backend
HASH=$(node db/hash-password.js '<seed password>')
psql "$DATABASE_URL" -v seed_hash="$HASH" -f db/001_users_and_ownership.sql
```

Change the seed user's password or disable the account before production use.

Then add the admin role and the default admin `admin@admin.com` (safe to re-run). Its initial password is `12345678`; **change it before production use** (there is no change-password feature: generate a new hash with `hash-password.js` and update `users.password_hash`):

```
HASH=$(node db/hash-password.js '12345678')
psql "$DATABASE_URL" -v admin_hash="$HASH" -f db/002_admin_role.sql
```

The admin signs in on the normal login form and sees a dashboard of all users with their customer counts.

## Deals

Apply `db/003_deals.sql` (no variables, safe to re-run) before deploying the deals-enabled backend:

```
psql "$DATABASE_URL" -f db/003_deals.sql
```

A deal is a sales opportunity with a customer (title, amount in INR, stage lead / qualified / proposal / won / lost, optional expected close date). Sales users manage them from the **Deals** button on each customer row, or through `/api/customers/:id/deals` and `/api/deals`. Deleting a customer also deletes its deals.

## Exporting customers

`GET /api/customers/export` (sales users, Bearer token) downloads the caller's own customers as `customers_YYYY-MM-DD.xlsx`; the optional `?name=` filter matches the list endpoint, and the UI's **Export to Excel** button sends the current search text. The file is built in memory and sent in one response, so it is bounded by Vercel's response size limit (about 4.5 MB), far above a normal customer list.

## Deploy to Vercel

Create two Vercel projects from this repo.

**Backend** (root directory `backend`) - environment variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `CORS_ORIGIN` | Frontend URL(s), comma-separated |
| `JWT_SECRET` | Long random string used to sign login tokens |
| `JWT_EXPIRES_IN` | optional, defaults to `8h` |
| `ANTHROPIC_MODEL` | optional, defaults to `claude-sonnet-5-5` |

**Frontend** (root directory `frontend`) - environment variable:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | Deployed backend URL (no trailing slash) |

Deploy the backend first, then set `VITE_API_URL` and deploy the frontend, then set `CORS_ORIGIN` on the backend to the frontend URL and redeploy it. Never commit `.env` files.
