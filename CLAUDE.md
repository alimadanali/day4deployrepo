# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow: spec-driven development

- Specs are written to the `_specs/` folder.
- Once a spec is approved, the implementation plan is created and stored in `_plans/`.
- Before starting implementation, make sure the current branch is committed (clean working tree).

## Layout

Two independent npm projects (no root package.json, no tests, no linter configured), each deployed as its own Vercel project:

- `backend/` — Express 5 REST API (ESM, Node >=20), Postgres via `pg`, Swagger docs, Claude-powered agent endpoint
- `frontend/` — React 19 + Vite UI (customer CRUD table/form + chat assistant)

## Commands

```
# backend (http://localhost:3001, Swagger UI at /swagger)
cd backend && cp .env.example .env && npm install
npm start        # node src/index.js
npm run dev      # node --watch

# frontend (http://localhost:5173)
cd frontend && cp .env.example .env && npm install
npm run dev | build | preview
```

Backend env: `JWT_SECRET` (required), `JWT_EXPIRES_IN` (default `8h`), `DATABASE_URL` (Postgres; the pool forces SSL with `rejectUnauthorized: false`), `ANTHROPIC_API_KEY`, `CORS_ORIGIN` (comma-separated, defaults to `*`), `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Frontend env: `VITE_API_URL` (no trailing slash). The `customers` table (`customer_id`, `customer_name`, `email`, `created_at`) is not created by any code here; it must already exist. Auth adds a `users` table and `customers.user_id` via `backend/db/001_users_and_ownership.sql` (applied manually with psql; see README).

## Architecture

**Backend entry points.** `src/app.js` builds and exports the Express app and holds all routes; `src/index.js` calls `app.listen` for local use, while `api/index.js` just re-exports the app as the Vercel serverless handler (`vercel.json` rewrites every path to `/api`). Keep route logic in `app.js` so both entries share it.

**Auth and ownership.** `src/auth.js` holds bcrypt/JWT helpers and the `requireAuth` middleware (Bearer token sets `req.user`). `/api/customers*` and `/api/agent` are behind it; `/api/auth/register|login` return `{ token, user }`. Every customer function in `src/db.js` takes `userId` first and filters on `user_id`, so users can only see or change their own customers (others' ids return 404). Never add an unscoped customer query. The agent receives `userId` from `req.user` on the server and passes it to each tool handler; the model never sees or supplies it. The frontend keeps the token in `localStorage` (`src/api.js`) and clears it on any 401.

**Three places describe the customer API and must be kept in sync** when adding/changing an endpoint or field:
1. Routes in `src/app.js` (including the auth routes) (validation and error shape `{ error }` are done inline; async handlers go through the `wrap` helper)
2. The hand-written OpenAPI spec in `src/swagger.js` (not generated from routes). Swagger UI is loaded from a CDN, deliberately, because serving it from node_modules is unreliable on Vercel.
3. For agent-accessible operations, the tool definitions and `handlers` map in `src/agent.js`

All SQL lives in `src/db.js` (parameterized queries; `updateCustomer` uses `COALESCE` for partial updates). Both the REST routes and agent tools call these same functions.

**Agent (`POST /api/agent`).** `runAgent` in `src/agent.js` runs a manual tool-use loop against the Anthropic SDK (max 8 iterations): Claude calls DB-backed tools, results go back as `tool_result` blocks, and it returns `{ reply, toolCalls }`. The client sends `history` as plain `{role, content}` text turns; tool-use blocks are not persisted between requests. Tool errors are returned to the model with `is_error: true`.

**Frontend.** `src/api.js` is the single fetch wrapper (errors surface `body.error`); `App.jsx` handles session restore and renders `AuthForm.jsx` when logged out, otherwise the customer view, which owns customer state, `CustomerForm.jsx` handles create/edit, `Chat.jsx` talks to `/api/agent`.

## Deployment

Per `README.md`: deploy backend first, set `VITE_API_URL` on the frontend project, deploy the frontend, then set `CORS_ORIGIN` on the backend to the frontend URL and redeploy. Never commit `.env` files. The pool is capped at `max: 3` to avoid exhausting DB connections from serverless instances.
