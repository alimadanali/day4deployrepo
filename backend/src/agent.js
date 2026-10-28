import Anthropic from '@anthropic-ai/sdk';
import * as db from './db.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const tools = [
  {
    name: 'get_all_customers',
    description: 'Get all customers.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_customer_by_name',
    description: 'Find customers whose name contains the given text (case-insensitive).',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'add_customer',
    description: 'Add a new customer.',
    input_schema: {
      type: 'object',
      properties: { customer_name: { type: 'string' }, email: { type: 'string' } },
      required: ['customer_name', 'email'],
    },
  },
  {
    name: 'update_customer',
    description: 'Update a customer name and/or email by customer id.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'integer' },
        customer_name: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'delete_customer',
    description: 'Delete a customer by customer id.',
    input_schema: {
      type: 'object',
      properties: { customer_id: { type: 'integer' } },
      required: ['customer_id'],
    },
  },
];

const handlers = {
  get_all_customers: () => db.listCustomers(),
  get_customer_by_name: ({ name }) => db.findCustomersByName(name),
  add_customer: (a) => db.createCustomer(a),
  update_customer: ({ customer_id, ...rest }) => db.updateCustomer(customer_id, rest),
  delete_customer: ({ customer_id }) => db.deleteCustomer(customer_id),
};

const SYSTEM =
  'You are a customer-management assistant. Use the provided tools to read and modify customer data ' +
  'in the database. Never invent data; answer concisely based on tool results.';

/** Runs a tool-use loop; `history` is an array of {role, content} text turns. */
export async function runAgent(message, history = []) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not set in backend/.env');
    err.status = 503;
    throw err;
  }
  const client = new Anthropic();
  const messages = [...history, { role: 'user', content: message }];
  const toolCalls = [];

  for (let i = 0; i < 8; i++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason !== 'tool_use') {
      const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { reply, toolCalls };
    }
    const results = [];
    for (const block of res.content.filter((b) => b.type === 'tool_use')) {
      let content;
      let is_error = false;
      try {
        const out = await handlers[block.name](block.input);
        content = JSON.stringify(out ?? { message: 'not found' });
      } catch (e) {
        content = e.message;
        is_error = true;
      }
      toolCalls.push({ name: block.name, input: block.input });
      results.push({ type: 'tool_result', tool_use_id: block.id, content, is_error });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'Stopped after too many tool steps.', toolCalls };
}
