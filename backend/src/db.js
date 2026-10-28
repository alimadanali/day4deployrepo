import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const COLS = 'customer_id, customer_name, email, created_at';

export async function listCustomers() {
  return (await pool.query(`SELECT ${COLS} FROM customers ORDER BY customer_id`)).rows;
}

export async function getCustomer(id) {
  return (await pool.query(`SELECT ${COLS} FROM customers WHERE customer_id = $1`, [id])).rows[0];
}

export async function findCustomersByName(name) {
  return (
    await pool.query(
      `SELECT ${COLS} FROM customers WHERE customer_name ILIKE $1 ORDER BY customer_id`,
      [`%${name}%`],
    )
  ).rows;
}

export async function createCustomer({ customer_name, email }) {
  return (
    await pool.query(
      `INSERT INTO customers (customer_name, email) VALUES ($1, $2) RETURNING ${COLS}`,
      [customer_name, email],
    )
  ).rows[0];
}

export async function updateCustomer(id, { customer_name, email }) {
  return (
    await pool.query(
      `UPDATE customers SET customer_name = COALESCE($2, customer_name), email = COALESCE($3, email)
       WHERE customer_id = $1 RETURNING ${COLS}`,
      [id, customer_name ?? null, email ?? null],
    )
  ).rows[0];
}

export async function deleteCustomer(id) {
  return (await pool.query(`DELETE FROM customers WHERE customer_id = $1 RETURNING ${COLS}`, [id]))
    .rows[0];
}
