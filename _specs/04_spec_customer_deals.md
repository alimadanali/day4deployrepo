# Spec 04: Customer Deals

Status: Approved. Implementation plan: `_plans/04_plan_customer_deals.md`.

## 1. Background

The application tracks customers per sales user, but not the sales opportunities with them. This feature adds **deals**: a deal is a specific sales opportunity with one customer.

Example: Sunrise Hospital wants 5,000 printed brochures. Priya (a sales user) creates a deal for that customer:

- Title: "Brochure printing - Q4"
- Amount: ₹1,50,000
- Stage: Lead, Qualified, Proposal, then Won or Lost
- Expected close date: 30 Nov

One customer can have many deals over time (brochures this month, ID cards next month). Deals follow the ownership rules from Spec 01: a sales user only ever sees and changes deals for their own customers.

## 2. Goals

- Create, view, edit and delete deals for a customer.
- Support many deals per customer.
- Track each deal's stage through Lead, Qualified, Proposal, Won, Lost.
- Restrict all deal access to the owner of the customer (REST API and UI).
- Show a customer's deals and totals in the UI, and move a deal between stages quickly.
- Document the new endpoints in Swagger.

## 3. Non-goals

- Admin visibility of deals (the admin dashboard is unchanged; admins get `403` on deal routes like on customer routes).
- Deals in the AI agent (tools and prompt are unchanged), Excel export of deals, or a kanban board.
- Multiple currencies or conversions: all amounts are in Indian rupees (INR).
- Line items, products, probabilities, owners other than the customer's owner, notes, attachments, stage history or audit log.
- Moving a deal to another customer.
- Enforced stage order: a deal can be moved to any stage (including back from Won or Lost, to fix a mistake).

## 4. Data model

### 4.1 New `deals` table

| Column | Type | Notes |
| --- | --- | --- |
| `deal_id` | serial primary key | |
| `customer_id` | integer not null references `customers(customer_id)` on delete cascade | Owning customer |
| `user_id` | integer not null references `users(user_id)` | The customer's owner; set by the server, never by the client |
| `title` | text not null | Non-empty after trimming |
| `amount` | numeric(14,2) not null check (`amount >= 0`) | In INR |
| `stage` | text not null default `'lead'` | Check constraint: `lead`, `qualified`, `proposal`, `won`, `lost` |
| `expected_close_date` | date | Optional |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | Set on every update |

- Indexes on `deals(user_id)` and `deals(customer_id)`.
- `user_id` is stored on the deal (copied from the customer when the deal is created) so every deal query can filter on it directly, as for customers: the SQL layer, not only route handlers, enforces ownership.
- `amount` is returned to clients as a JSON number (not a string), converted in the data layer.
- The SQL is delivered as `backend/db/003_deals.sql`, applied manually with psql (no migration tooling in the repo), and is safe to re-run (`IF NOT EXISTS`).

### 4.2 Deleting a customer

Deleting a customer also deletes its deals (`on delete cascade`). The UI delete confirmation names the number of deals that will be removed (see section 8). See decision 1.

## 5. API

All errors keep the shape `{ "error": "message" }`. All deal routes require a sales token: `401` without a valid token, `403` for an admin token (they are added to the guard that already covers `/api/customers*` and `/api/agent`).

Access control: a customer or deal that does not exist **or** belongs to another user returns `404` (same response), as in Spec 01.

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/customers/:id/deals` | The customer's deals, newest first. `404` if the customer is not the caller's. |
| `POST /api/customers/:id/deals` | Creates a deal for that customer, with `user_id` = caller. `404` if the customer is not the caller's. `201` returns the deal. |
| `GET /api/deals` | All of the caller's deals, with `customer_name`. Optional `stage` filter. Newest first. |
| `GET /api/deals/:id` | One deal; `404` if missing or not the caller's. |
| `PUT /api/deals/:id` | Partial update of `title`, `amount`, `stage`, `expected_close_date`; `404` if not the caller's. `expected_close_date: null` clears it. |
| `DELETE /api/deals/:id` | Deletes the deal and returns it; `404` if not the caller's. |

Validation (`400`):
- `title`: required on create, non-empty after trimming, at most 200 characters.
- `amount`: required on create, a finite number, at least 0, at most 999,999,999,999.99, at most 2 decimal places.
- `stage`: must be one of the five values; defaults to `lead` on create.
- `expected_close_date`: optional, ISO `YYYY-MM-DD`, a real calendar date.
- A `customer_id`, `user_id` or `deal_id` in the body is ignored.
- `id` path parameters must be integers (`400 id must be an integer`), as for customers.

Deal response shape:

```json
{
  "deal_id": 1,
  "customer_id": 3,
  "customer_name": "Sunrise Hospital",
  "title": "Brochure printing - Q4",
  "amount": 150000,
  "stage": "lead",
  "expected_close_date": "2026-11-30",
  "created_at": "2026-10-29T10:00:00Z",
  "updated_at": "2026-10-29T10:00:00Z"
}
```

(`customer_name` is included on `GET /api/deals`; the per-customer list and single-deal responses may omit it.) `expected_close_date` is a plain date string with no time zone shifts.

Routes are registered so `/api/deals/:id` and `/api/customers/:id/deals` do not collide with `GET /api/customers/export` or `/api/customers/:id`.

## 6. Data layer

All SQL lives in `src/db.js` (parameterized queries), each function taking `userId` first and filtering `user_id = $1`, like the customer functions: `listDeals`, `listCustomerDeals`, `getDeal`, `createDeal`, `updateDeal` (partial update with `COALESCE`, plus a way to clear the date), `deleteDeal`.

`createDeal` inserts only if the customer belongs to the user, in one statement (`INSERT ... SELECT ... FROM customers WHERE customer_id = $2 AND user_id = $1`), so there is no gap between the ownership check and the insert.

## 7. Swagger documentation

Update `src/swagger.js`:
- A new **Deals** tag with all six endpoints, each with `security: [{ bearerAuth: [] }]` and `401`, `403` (admin token) and `404` (not found or not owned) responses.
- Schemas: `Deal`, `DealInput` (create), `DealUpdate`, with the `stage` enum and examples (the brochure deal above).
- `GET /api/deals` documents the optional `stage` filter.

## 8. Frontend

- Each customer row gets a **Deals** action that opens a deals panel (modal or drawer) for that customer, showing:
  - A table of its deals: title, amount, stage, expected close date.
  - **Add deal** and per-deal **Edit** and **Delete** (with confirmation).
  - A stage dropdown on each row to change the stage in one step.
  - A small total: open pipeline (Lead + Qualified + Proposal), Won and Lost amounts.
- The deal form has title, amount (₹), stage and expected close date, with the same inline error pattern as the customer form.
- Amounts are shown in Indian rupee format (`₹1,50,000`) using `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })` (with decimals only when the amount has paise). Stages are shown with readable labels and a colour per stage.
- The customer delete confirmation says how many deals will also be deleted.
- `src/api.js` gets the deal calls through the same fetch wrapper; a `401` clears the session as today.
- The admin dashboard is unchanged.

## 9. Documentation

`README.md` (the `003` migration step and a short deals note) and `CLAUDE.md` (deals tables and ownership: every deal query scoped by `user_id`, `user_id` copied from the customer on create; deal routes behind `requireSales`; add the deal routes to the "three places must be kept in sync" note) are updated. `.env.example` is unchanged.

## 10. Decisions and open questions

Proposed decisions (confirm at approval):

1. **Deleting a customer deletes its deals** (cascade), with the count shown in the confirmation. The alternative, blocking the delete while deals exist, would force the user to delete deals one by one first.
2. **Amounts are INR only**, stored as `numeric(14,2)` and shown with Indian digit grouping.
3. **Stages move freely**; Won and Lost can be reopened.
4. **`expected_close_date` is optional** and stored as a date; the year is part of the value (the "30 Nov" example becomes `2026-11-30` in the form).
5. **Agent and admin are out of scope** for this feature (section 3).

Decided at approval: the proposed defaults above are accepted, and deals are not added to the AI agent in this spec. Open questions: none.

## 11. Acceptance criteria

1. A sales user can create a deal for one of their customers with title, amount, stage and expected close date, and the response matches the shape in section 5.
2. A customer can have several deals; the per-customer list returns all of them, newest first.
3. A new deal without a stage gets `lead`; an invalid stage, a negative or non-numeric amount, a title that is empty or over 200 characters, or an invalid date returns `400`.
4. User B calling any deal endpoint with user A's deal id or customer id gets `404`, and A's data is unchanged. A `customer_id` or `user_id` in the create body is ignored.
5. `GET /api/deals` returns only the caller's deals with `customer_name`, and `?stage=won` filters them.
6. `PUT` can change any field, move a deal between any two stages, and clear the date with `null`; `updated_at` changes.
7. Deleting a deal removes it; deleting a customer also removes its deals.
8. Without a token the deal routes return `401`; with an admin token `403`.
9. `1,50,000` renders as `₹1,50,000` in the UI, the stage dropdown changes the stage in place, and the totals (open, won, lost) update.
10. Swagger UI documents the Deals endpoints and the full flow (Authorize, create, list, update, delete) works from it.
11. After the migration, existing customers and their behaviour are unchanged, and `README.md` and `CLAUDE.md` reflect the new table and routes.
