# Customer Manager

- `backend/` - Express REST API, Swagger UI at `/swagger`, Postgres, Claude-powered `/api/agent`
- `frontend/` - React + Vite UI (customer CRUD + chat assistant)

## Local development

```
cd backend  && cp .env.example .env && npm install && npm start   # http://localhost:3001
cd frontend && cp .env.example .env && npm install && npm run dev  # http://localhost:5173
```

## Deploy to Vercel

Create two Vercel projects from this repo.

**Backend** (root directory `backend`) - environment variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `CORS_ORIGIN` | Frontend URL(s), comma-separated |
| `ANTHROPIC_MODEL` | optional, defaults to `claude-sonnet-5-5` |

**Frontend** (root directory `frontend`) - environment variable:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | Deployed backend URL (no trailing slash) |

Deploy the backend first, then set `VITE_API_URL` and deploy the frontend, then set `CORS_ORIGIN` on the backend to the frontend URL and redeploy it. Never commit `.env` files.
