import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger.js';
import * as db from './db.js';
import { runAgent } from './agent.js';

const app = express();
const origins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json());

app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const parseId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return null;
  }
  return id;
};

app.get('/api/customers', wrap(async (req, res) => {
  res.json(req.query.name ? await db.findCustomersByName(req.query.name) : await db.listCustomers());
}));

app.get('/api/customers/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const c = await db.getCustomer(id);
  c ? res.json(c) : res.status(404).json({ error: 'Customer not found' });
}));

app.post('/api/customers', wrap(async (req, res) => {
  const { customer_name, email } = req.body ?? {};
  if (!customer_name || !email) return res.status(400).json({ error: 'customer_name and email are required' });
  res.status(201).json(await db.createCustomer({ customer_name, email }));
}));

app.put('/api/customers/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const c = await db.updateCustomer(id, req.body ?? {});
  c ? res.json(c) : res.status(404).json({ error: 'Customer not found' });
}));

app.delete('/api/customers/:id', wrap(async (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const c = await db.deleteCustomer(id);
  c ? res.json(c) : res.status(404).json({ error: 'Customer not found' });
}));

app.post('/api/agent', wrap(async (req, res) => {
  const { message, history } = req.body ?? {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  res.json(await runAgent(message, Array.isArray(history) ? history : []));
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API on http://localhost:${port}  Swagger: /swagger`));
