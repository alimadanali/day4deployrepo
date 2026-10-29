# Plan 03: Export Customers to Excel

Implements `_specs/03_spec_export_customer.md` (approved). Execute the steps in order. Each step leaves the app runnable, so it can be committed on its own.

Prerequisite: the working tree is clean and committed (workflow rule in `CLAUDE.md`). Do the work on a feature branch, e.g. `feature/export-customers`.

There is no test framework in the repo. Verification is manual (curl / Swagger UI / browser). No database change, so no migration.

## Step 1: Dependency (backend)

- `cd backend && npm install exceljs` (pure JS, no native build, works on Vercel).
- No new env vars, so `.env.example` is unchanged.

## Step 2: Workbook helper (`backend/src/export.js`, new)

- `buildCustomersWorkbook(customers)` returns an `exceljs` `Workbook` with one sheet named `Customers`:
  - Columns in order: `ID` (`customer_id`), `Name` (`customer_name`), `Email` (`email`), `Created` (`created_at`).
  - Bold header row, frozen (`views: [{ state: 'frozen', ySplit: 1 }]`).
  - `Created` is written as a `Date` with `numFmt` `yyyy-mm-dd hh:mm`; skip the value if `created_at` is null.
  - Column widths computed from the longest value in each column, clamped to a minimum (e.g. 10) and maximum (e.g. 50).
  - `user_id` is not exported.
- `safeText(value)`: if a string starts with `=`, `+`, `-` or `@`, prefix it with `'` so Excel treats it as text, not a formula; applied to Name and Email only (ID and Created are not user text). Written as plain string cells.
- Zero customers still yields the header row only.

## Step 3: Route (`backend/src/app.js`)

- Add `GET /api/customers/export` **above** `app.get('/api/customers/:id', ...)`, otherwise `export` is parsed as an id and returns `400`. It sits behind the existing `requireAuth` + `requireSales` guard on `/api/customers*`, so admins get `403` and no token gets `401` with no new auth code.
- Handler (wrapped with `wrap`):
  1. `const name = req.query.name?.trim()`; load `name ? db.findCustomersByName(req.user.user_id, name) : db.listCustomers(req.user.user_id)` (the same scoped functions as the list route; no new SQL).
  2. Build the workbook with the helper.
  3. Set `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="customers_YYYY-MM-DD.xlsx"` (UTC date from `new Date().toISOString().slice(0, 10)`).
  4. `await workbook.xlsx.write(res); res.end()`. Headers are only set once the data is loaded, so database errors still go through the error handler as JSON.
- The browser needs to read `Content-Disposition`; the existing `cors({ origin })` does not expose it by default, so add `exposedHeaders: ['Content-Disposition']` to the cors options.

Verify with curl (use the Bearer token of a sales user): the response is a valid file (`file customers.xlsx` reports Microsoft Excel 2007+, or open it); `?name=` filters; no token gives `401`; an admin token gives `403`; the route is not shadowed by `/:id`.

## Step 4: Swagger (`backend/src/swagger.js`)

- Add `GET /api/customers/export` under the **Customers** tag, placed before `/api/customers/{id}`, with `security: secured`, the optional `name` query parameter (same description as the list), and responses:
  - `200` with content type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and schema `{ type: 'string', format: 'binary' }`
  - `401: unauthorized`, `403: notSales`
- Description states that only the caller's customers are included.

Verify at `/swagger`: Authorize with a sales token, run the endpoint, download the file.

## Step 5: Frontend

- `src/api.js`: add `exportCustomers(name)`. It reuses the token and `BASE`, requests `/api/customers/export` (with `?name=` when set), and on success returns `{ blob, filename }`, taking the filename from the `Content-Disposition` header (`customers.xlsx` as the fallback). Errors are read from the JSON body like `request`. A `401` clears the token and calls the unauthorized handler, as today. To avoid duplicating the 401 handling, factor the shared part out of `request` rather than copying it.
- `App.jsx` (`Customers` component):
  - Add an **Export to Excel** button in the toolbar next to "+ Add customer", with `exporting` state that disables it while the download runs.
  - On click: `api.exportCustomers(search.trim())`, then create an object URL from the blob, click a temporary `<a download>`, and revoke the URL. Failures show in the existing `error` alert.
  - It uses the current search text, so the file matches the on-screen list (decision 2).
- `styles.css`: only if the toolbar needs spacing for the second button.

Verify in the browser: Export with an empty search downloads all of the user's customers; type a name and Export again to get only the matches; the filename is `customers_YYYY-MM-DD.xlsx`; a second user's export contains none of the first user's rows; the admin dashboard has no export button.

## Step 6: Docs

- `README.md`: add a short note on the export endpoint and the Vercel response-size bound (about 4.5 MB, far above a normal customer list).
- `CLAUDE.md`: mention `GET /api/customers/export` (registered before `/:id`, built in `src/export.js`, uses the scoped list functions) and add it to the "three places must be kept in sync" list. Add `exceljs` to the backend description if dependencies are listed.

## Step 7: Final verification against the spec's acceptance criteria

Walk through criteria 1 to 10 with two sales users and the admin. In particular: A's file has none of B's rows and the reverse; `?name=` filters within the caller's own customers; a user with no customers gets a header-only file; a customer named `=1+1` opens as text, not a formula; `Created` is a real date cell; admin gets `403`. Then commit, merge to `main` and push when you ask.

## Risks and notes

- **Route order:** the export route must precede `/api/customers/:id`; it is the one easy-to-miss bug here.
- **CORS header:** without `exposedHeaders`, the browser cannot read the filename and falls back to `customers.xlsx`; the download still works.
- **Memory and size:** the workbook is built in memory. Fine for one user's customers; if lists grow very large, switch to streaming or pagination (out of scope).
- **Formula escaping:** the `'` prefix shows up as a literal apostrophe in some viewers. This is the accepted trade-off for blocking formula injection.
- **Dependencies:** `exceljs` adds a noticeable amount to `node_modules`; it only affects the backend and its cold-start size on Vercel.
