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
