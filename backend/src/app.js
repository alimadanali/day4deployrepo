import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerSpec, { swaggerHtml } from './swagger.js';
import * as db from './db.js';
import { runAgent } from './agent.js';
import { buildCustomersWorkbook } from './export.js';
import { hashPassword, verifyPassword, signToken, requireAuth, requireSales, requireAdmin } from './auth.js';

const app = express();
const origins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());

// Swagger UI assets come from a CDN: serving them from node_modules is unreliable on Vercel.
app.get('/swagger.json', (_req, res) => res.json(swaggerSpec));
app.get(['/swagger', '/swagger/'], (_req, res) => res.type('html').send(swaggerHtml));
app.get('/', (_req, res) => res.redirect('/swagger'));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const parseId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return null;
  }
  return id;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authResponse = (user) => ({
  token: signToken(user),
  user: { user_id: user.user_id, name: user.name, email: user.email, role: user.role },
});

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email is not valid' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  const user = await db.createUser({ name, email, password_hash: await hashPassword(password) });
  res.status(201).json(authResponse(user));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const user = await db.findUserByEmail(email);
  const valid = await verifyPassword(password, user?.password_hash);
  if (!user || !valid) return res.status(401).json({ error: 'Invalid email or password' });
  res.json(authResponse(user));
}));

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const user = await db.getUser(req.user.user_id);
  user ? res.json(user) : res.status(401).json({ error: 'User no longer exists' });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json(await db.listUsersWithCustomerCounts());
}));

app.get('/api/admin/stats', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json(await db.getStats());
}));

app.use(['/api/customers', '/api/deals', '/api/agent'], requireAuth, requireSales);

const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];
const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Validates the deal fields in body; returns { error } or { fields }. Other keys (customer_id, user_id) are ignored. */
function validateDeal(body, { partial }) {
  const fields = {};
  const { title, amount, stage, expected_close_date: date } = body ?? {};
  if (!partial || title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200)
      return { error: 'title is required and must be 1 to 200 characters' };
    fields.title = title.trim();
  }
  if (!partial || amount !== undefined) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 999999999999.99 || Number(amount.toFixed(2)) !== amount)
      return { error: 'amount must be a number from 0 to 999999999999.99 with at most 2 decimals' };
    fields.amount = amount;
  }
  if (stage !== undefined && !STAGES.includes(stage)) return { error: `stage must be one of ${STAGES.join(', ')}` };
  if (stage !== undefined || !partial) fields.stage = stage ?? 'lead';
  if (date !== undefined) {
    if (date !== null && !(typeof date === 'string' && isRealDate(date)))
      return { error: 'expected_close_date must be a valid date (YYYY-MM-DD) or null' };
    fields.expected_close_date = date;
  }
  return { fields };
}

app.get('/api/customers', wrap(async (req, res) => {
  res.json(req.query.name
    ? await db.findCustomersByName(req.user.user_id, req.query.name)
    : await db.listCustomers(req.user.user_id));
}));

// Registered before /:id, otherwise "export" would be parsed as an id.
app.get('/api/customers/export', wrap(async (req, res) => {
  const name = req.query.name?.trim();
  const customers = name
    ? await db.findCustomersByName(req.user.user_id, name)
    : await db.listCustomers(req.user.user_id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await buildCustomersWorkbook(customers).xlsx.write(res);
  res.end();
}));

app.get('/api/customers/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const c = await db.getCustomer(req.user.user_id, id);
  c ? res.json(c) : res.status(404).json({ error: 'Customer not found' });
}));

app.post('/api/customers', wrap(async (req, res) => {
  const { customer_name, email } = req.body ?? {};
  if (!customer_name || !email) return res.status(400).json({ error: 'customer_name and email are required' });
  res.status(201).json(await db.createCustomer(req.user.user_id, { customer_name, email }));
}));

app.put('/api/customers/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const c = await db.updateCustomer(req.user.user_id, id, req.body ?? {});
  c ? res.json(c) : res.status(404).json({ error: 'Customer not found' });
}));

app.delete('/api/customers/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const c = await db.deleteCustomer(req.user.user_id, id);
  c ? res.json(c) : res.status(404).json({ error: 'Customer not found' });
}));

app.get('/api/customers/:id/deals', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  if (!(await db.getCustomer(req.user.user_id, id))) return res.status(404).json({ error: 'Customer not found' });
  res.json(await db.listCustomerDeals(req.user.user_id, id));
}));

app.post('/api/customers/:id/deals', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const { error, fields } = validateDeal(req.body, { partial: false });
  if (error) return res.status(400).json({ error });
  const deal = await db.createDeal(req.user.user_id, id, fields);
  deal ? res.status(201).json(deal) : res.status(404).json({ error: 'Customer not found' });
}));

app.get('/api/deals', wrap(async (req, res) => {
  const { stage } = req.query;
  if (stage !== undefined && !STAGES.includes(stage)) return res.status(400).json({ error: `stage must be one of ${STAGES.join(', ')}` });
  res.json(await db.listDeals(req.user.user_id, stage));
}));

app.get('/api/deals/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const d = await db.getDeal(req.user.user_id, id);
  d ? res.json(d) : res.status(404).json({ error: 'Deal not found' });
}));

app.put('/api/deals/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const { error, fields } = validateDeal(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const d = await db.updateDeal(req.user.user_id, id, fields);
  d ? res.json(d) : res.status(404).json({ error: 'Deal not found' });
}));

app.delete('/api/deals/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const d = await db.deleteDeal(req.user.user_id, id);
  d ? res.json(d) : res.status(404).json({ error: 'Deal not found' });
}));

app.post('/api/agent', wrap(async (req, res) => {
  const { message, history } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  res.json(await runAgent(message, Array.isArray(history) ? history : [], req.user.user_id));
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

export default app;
