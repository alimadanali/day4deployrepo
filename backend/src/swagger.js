const customer = {
  type: 'object',
  properties: {
    customer_id: { type: 'integer', example: 1 },
    customer_name: { type: 'string', example: 'Jane Doe' },
    email: { type: 'string', example: 'jane@example.com' },
    created_at: { type: 'string', format: 'date-time' },
  },
};
const input = {
  type: 'object',
  properties: {
    customer_name: { type: 'string', example: 'Jane Doe' },
    email: { type: 'string', example: 'jane@example.com' },
  },
};
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const json = (schema) => ({ 'application/json': { schema } });
const ok = (description, schema) => ({ description, content: json(schema) });

export default {
  openapi: '3.0.3',
  info: { title: 'Customer API', version: '1.0.0', description: 'CRUD on customers plus an AI agent endpoint.' },
  tags: [{ name: 'Customers' }, { name: 'Agent' }],
  paths: {
    '/api/customers': {
      get: {
        tags: ['Customers'],
        summary: 'List all customers',
        parameters: [{ name: 'name', in: 'query', schema: { type: 'string' }, description: 'Filter by name (contains)' }],
        responses: { 200: ok('Customers', { type: 'array', items: customer }) },
      },
      post: {
        tags: ['Customers'],
        summary: 'Create a customer',
        requestBody: { required: true, content: json({ ...input, required: ['customer_name', 'email'] }) },
        responses: { 201: ok('Created', customer), 400: { description: 'Validation error' } },
      },
    },
    '/api/customers/{id}': {
      get: {
        tags: ['Customers'],
        summary: 'Get a customer by id',
        parameters: [idParam],
        responses: { 200: ok('Customer', customer), 404: { description: 'Not found' } },
      },
      put: {
        tags: ['Customers'],
        summary: 'Update a customer',
        parameters: [idParam],
        requestBody: { required: true, content: json(input) },
        responses: { 200: ok('Updated', customer), 404: { description: 'Not found' } },
      },
      delete: {
        tags: ['Customers'],
        summary: 'Delete a customer',
        parameters: [idParam],
        responses: { 200: ok('Deleted', customer), 404: { description: 'Not found' } },
      },
    },
    '/api/agent': {
      post: {
        tags: ['Agent'],
        summary: 'Ask a natural-language question about customers',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['message'],
            properties: {
              message: { type: 'string', example: 'Show me all customers' },
              history: {
                type: 'array',
                description: 'Optional prior {role, content} text turns',
                items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } },
              },
            },
          }),
        },
        responses: {
          200: ok('Agent reply', {
            type: 'object',
            properties: { reply: { type: 'string' }, toolCalls: { type: 'array', items: { type: 'object' } } },
          }),
          503: { description: 'ANTHROPIC_API_KEY not configured' },
        },
      },
    },
  },
};
