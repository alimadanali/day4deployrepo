import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3, // keep serverless instances from exhausting DB connections
});

const USER_COLS = 'user_id, name, email, role, created_at';

export async function createUser({ name, email, password_hash }) {
  try {
    return (
      await pool.query(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, lower($2), $3) RETURNING ${USER_COLS}`,
        [name, email, password_hash],
      )
    ).rows[0];
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('Email is already registered');
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

/** Includes password_hash; for login only. */
export async function findUserByEmail(email) {
  return (await pool.query('SELECT * FROM users WHERE email = lower($1)', [email])).rows[0];
}

export async function getUser(id) {
  return (await pool.query(`SELECT ${USER_COLS} FROM users WHERE user_id = $1`, [id])).rows[0];
}

// Every customer query is scoped to its owner (userId) so no path can touch another user's rows.
const COLS = 'customer_id, customer_name, email, created_at, user_id';

export async function listCustomers(userId) {
  return (
    await pool.query(`SELECT ${COLS} FROM customers WHERE user_id = $1 ORDER BY customer_id`, [userId])
  ).rows;
}

export async function getCustomer(userId, id) {
  return (
    await pool.query(`SELECT ${COLS} FROM customers WHERE user_id = $1 AND customer_id = $2`, [userId, id])
  ).rows[0];
}

export async function findCustomersByName(userId, name) {
  return (
    await pool.query(
      `SELECT ${COLS} FROM customers WHERE user_id = $1 AND customer_name ILIKE $2 ORDER BY customer_id`,
      [userId, `%${name}%`],
    )
  ).rows;
}

export async function createCustomer(userId, { customer_name, email }) {
  return (
    await pool.query(
      `INSERT INTO customers (customer_name, email, user_id) VALUES ($1, $2, $3) RETURNING ${COLS}`,
      [customer_name, email, userId],
    )
  ).rows[0];
}

export async function updateCustomer(userId, id, { customer_name, email }) {
  return (
    await pool.query(
      `UPDATE customers SET customer_name = COALESCE($3, customer_name), email = COALESCE($4, email)
       WHERE user_id = $1 AND customer_id = $2 RETURNING ${COLS}`,
      [userId, id, customer_name ?? null, email ?? null],
    )
  ).rows[0];
}

export async function deleteCustomer(userId, id) {
  return (
    await pool.query(`DELETE FROM customers WHERE user_id = $1 AND customer_id = $2 RETURNING ${COLS}`, [
      userId,
      id,
    ])
  ).rows[0];
}

// Deals are scoped like customers: every query filters on the owner's user_id, which createDeal copies from the customer.
// amount is cast to a number and the date formatted in Postgres, so JS never shifts it across time zones.
const DEAL_COLS = `d.deal_id, d.customer_id, d.title, d.amount::float8 AS amount, d.stage,
  to_char(d.expected_close_date, 'YYYY-MM-DD') AS expected_close_date, d.created_at, d.updated_at`;

export async function listDeals(userId, stage) {
  return (
    await pool.query(
      `SELECT ${DEAL_COLS}, c.customer_name FROM deals d JOIN customers c ON c.customer_id = d.customer_id
       WHERE d.user_id = $1 AND ($2::text IS NULL OR d.stage = $2) ORDER BY d.created_at DESC, d.deal_id DESC`,
      [userId, stage ?? null],
    )
  ).rows;
}

export async function listCustomerDeals(userId, customerId) {
  return (
    await pool.query(
      `SELECT ${DEAL_COLS} FROM deals d WHERE d.user_id = $1 AND d.customer_id = $2
       ORDER BY d.created_at DESC, d.deal_id DESC`,
      [userId, customerId],
    )
  ).rows;
}

export async function getDeal(userId, id) {
  return (
    await pool.query(`SELECT ${DEAL_COLS} FROM deals d WHERE d.user_id = $1 AND d.deal_id = $2`, [userId, id])
  ).rows[0];
}

/** Inserts only if the customer belongs to the user, in one statement; undefined when it does not. */
export async function createDeal(userId, customerId, { title, amount, stage, expected_close_date }) {
  const { rows } = await pool.query(
    `INSERT INTO deals (customer_id, user_id, title, amount, stage, expected_close_date)
     SELECT customer_id, user_id, $3, $4, $5, $6 FROM customers WHERE customer_id = $2 AND user_id = $1
     RETURNING deal_id`,
    [userId, customerId, title, amount, stage, expected_close_date ?? null],
  );
  return rows[0] && getDeal(userId, rows[0].deal_id);
}

const DEAL_FIELDS = ['title', 'amount', 'stage', 'expected_close_date'];

/** Only keys present in `fields` are changed, so expected_close_date: null clears the date. */
export async function updateDeal(userId, id, fields) {
  const keys = DEAL_FIELDS.filter((k) => k in fields);
  if (!keys.length) return getDeal(userId, id);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const { rowCount } = await pool.query(
    `UPDATE deals SET ${sets}, updated_at = now() WHERE user_id = $1 AND deal_id = $2`,
    [userId, id, ...keys.map((k) => fields[k])],
  );
  return rowCount ? getDeal(userId, id) : undefined;
}

export async function deleteDeal(userId, id) {
  const deal = await getDeal(userId, id);
  if (!deal) return undefined;
  await pool.query('DELETE FROM deals WHERE user_id = $1 AND deal_id = $2', [userId, id]);
  return deal;
}

// Admin dashboard queries. These return counts only, never customer rows; they are the one
// intentional exception to per-user scoping above.
export async function listUsersWithCustomerCounts() {
  return (
    await pool.query(
      `SELECT u.user_id, u.name, u.email, u.role, u.created_at, count(c.customer_id)::int AS customer_count
       FROM users u LEFT JOIN customers c ON c.user_id = u.user_id
       GROUP BY u.user_id ORDER BY u.created_at, u.user_id`,
    )
  ).rows;
}

export async function getStats() {
  return (
    await pool.query(
      `SELECT (SELECT count(*) FROM users)::int AS total_users,
              (SELECT count(*) FROM users WHERE role = 'sales')::int AS total_sales_users,
              (SELECT count(*) FROM customers)::int AS total_customers`,
    )
  ).rows[0];
}
