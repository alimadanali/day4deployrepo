import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerSpec, { swaggerHtml } from './swagger.js';
import * as db from './db.js';
import { runAgent } from './agent.js';
import { hashPassword, verifyPassword, signToken, requireAuth, requireSales, requireAdmin } from './auth.js';

const app = express();
const origins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
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

app.use(['/api/customers', '/api/agent'], requireAuth, requireSales);

app.get('/api/customers', wrap(async (req, res) => {
  res.json(req.query.name
    ? await db.findCustomersByName(req.user.user_id, req.query.name)
    : await db.listCustomers(req.user.user_id));
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
