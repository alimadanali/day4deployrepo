# Spec 03: Export Customers to Excel

Status: Approved. Implementation plan: `_plans/03_plan_export_customer.md`.

## 1. Background

Sales users can view, add, edit and delete their customers in the UI, but cannot get the data out of the application. This feature lets a logged-in sales user download their customers as an Excel (`.xlsx`) file.

The export follows the ownership rules from Spec 01: it contains only the logged-in user's customers, never anyone else's.

## 2. Goals

- Download the logged-in user's customers as an `.xlsx` file from the UI and from the REST API.
- Include only customers owned by the caller. The scoping is enforced in the SQL layer, as for every other customer query.
- Make the file open cleanly in Excel, with readable headers and sensible column widths.
- Document the endpoint in Swagger.

## 3. Non-goals

- Importing customers from Excel.
- Other formats (CSV, PDF).
- Admin export. Admins own no customers and are rejected like on every other customer route (`403`). Exporting the users list is out of scope.
- Exporting through the AI agent.
- Choosing columns, multiple sheets, charts, scheduled or emailed exports.
- Pagination or background jobs. A user's customer list is small enough to build in one request.

## 4. Data model

No database changes. The export reads the existing `customers` table through the existing scoped `listCustomers(userId)` / `findCustomersByName(userId, name)` functions in `src/db.js`. No new SQL and no unscoped query.

## 5. API

All errors keep the shape `{ "error": "message" }`.

**`GET /api/customers/export`** (protected, sales only)

- Query: optional `name`, with the same "contains" filter as `GET /api/customers`, so the export can match what the user sees on screen. Without it, all of the caller's customers are exported.
- `200` returns the workbook with:
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="customers_YYYY-MM-DD.xlsx"` (server date, UTC)
- `401` without a valid token; `403` for an admin token (same as the other customer routes).
- If the user has no customers, the file is still returned, with the header row only.
- The route is registered **before** `GET /api/customers/:id`, otherwise `export` would be parsed as an id and return `400`.
- It sits behind the existing `requireAuth` + `requireSales` guards for `/api/customers*`, so it needs no extra auth code.

## 6. File format

One worksheet named `Customers`, with a bold header row (frozen) and one row per customer, ordered by `customer_id`:

| Column | Source | Notes |
| --- | --- | --- |
| ID | `customer_id` | Number |
| Name | `customer_name` | Text |
| Email | `email` | Text |
| Created | `created_at` | Real date-time cell formatted `yyyy-mm-dd hh:mm`, not text |

- `user_id` is not exported: it is always the caller's own id and has no meaning to the reader.
- Column widths fit the content (with a sensible minimum and maximum).
- **Spreadsheet formula injection:** a text cell whose value starts with `=`, `+`, `-` or `@` is written as a plain string cell, never a formula (one helper in the export module does this, for example by prefixing a `'`), so a customer named `=HYPERLINK(...)` cannot run as a formula when the file is opened.

## 7. Implementation notes

- Library: `exceljs` (pure JS, no native build, works on Vercel). Added to `backend/package.json`.
- The workbook is built in memory and written to the response with `workbook.xlsx.write(res)` (or buffered then sent), then ended. Errors before headers are sent go through the existing error handler.
- The Vercel serverless response limit (about 4.5 MB) is far above the size of a normal customer list; this limit is noted in the README as a known bound.
- Keep the route logic in `src/app.js`; put the workbook-building helper in a small new module (e.g. `src/export.js`) so the route stays short and the formula-escape helper has one home.

## 8. Swagger documentation

Update `src/swagger.js`:
- Add `GET /api/customers/export` under the **Customers** tag, with `security: [{ bearerAuth: [] }]`, the optional `name` query parameter, and responses `200` (content type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, schema `string` / `binary`), `401` and `403`.
- State in the description that only the caller's customers are included.

Testing through Swagger: log in, Authorize, run the endpoint and download the file.

## 9. Frontend

- An **Export to Excel** button in the customers toolbar, next to "+ Add customer".
- Because the endpoint needs the `Authorization` header, the button cannot be a plain link. `src/api.js` gets an `exportCustomers(name)` function that fetches the endpoint with the token, reads the response as a blob, and the UI triggers a download through a temporary object URL (revoked afterwards). The filename comes from `Content-Disposition`, with `customers.xlsx` as the fallback.
- The export uses the current search text, so "what you see is what you export". The button is disabled while the download runs, and failures are shown with the existing `alert` class.
- A `401` clears the session as for every other call.
- The admin dashboard is unchanged.

## 10. Decisions and open questions

Proposed decisions (confirm at approval):

1. **`exceljs`** is the library, to avoid the known security advisories on the community `xlsx` package.
2. **The export honours the `name` filter** (decided), so the file matches the on-screen list. Without a filter it exports everything.
3. **`user_id` is not exported**, and dates are real date cells.
4. **Admins cannot export**, consistent with the customer routes.

Decided: the file matches what is on screen, so the export honours the search box (decision 2). Open questions: none.

## 11. Acceptance criteria

1. `GET /api/customers/export` with a sales token returns an `.xlsx` file that opens in Excel with a `Customers` sheet, a header row and one row per customer.
2. The file contains only the caller's customers: with users A and B each owning customers, A's export has none of B's rows, and the reverse.
3. With `?name=jane` only matching customers (within the caller's own) are exported.
4. A user with no customers gets a valid file with only the header row.
5. Without a token the endpoint returns `401`; with an admin token `403`.
6. The route is not shadowed by `/api/customers/:id` (no `400 id must be an integer`).
7. `Created` is a real date-time cell, and a customer whose name starts with `=` is stored as text, not a formula.
8. The UI **Export to Excel** button downloads `customers_YYYY-MM-DD.xlsx` for the logged-in user, and respects the search box.
9. Swagger UI shows the endpoint and the download works from it after Authorize.
10. `README.md` and `CLAUDE.md` mention the export endpoint, and the "three places" sync note in `CLAUDE.md` covers it.
