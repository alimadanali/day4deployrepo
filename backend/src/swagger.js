const customer = {
  type: 'object',
  properties: {
    customer_id: { type: 'integer', example: 1 },
    user_id: { type: 'integer', example: 1, description: 'Owning sales user' },
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
const user = {
  type: 'object',
  properties: {
    user_id: { type: 'integer', example: 1 },
    name: { type: 'string', example: 'Sam Sales' },
    email: { type: 'string', example: 'sam@example.com' },
    role: { type: 'string', enum: ['sales', 'admin'], example: 'sales' },
  },
};
const adminUser = {
  type: 'object',
  properties: {
    ...user.properties,
    customer_count: { type: 'integer', example: 12 },
    created_at: { type: 'string', format: 'date-time' },
  },
};
const adminStats = {
  type: 'object',
  properties: {
    total_users: { type: 'integer', example: 5 },
    total_sales_users: { type: 'integer', example: 4 },
    total_customers: { type: 'integer', example: 40 },
  },
};
const authResponse = {
  type: 'object',
  properties: { token: { type: 'string', description: 'JWT; send as Authorization: Bearer <token>' }, user },
};
const secured = [{ bearerAuth: [] }];
const unauthorized = { description: 'Missing, invalid or expired token' };
const notSales = { description: 'Admin token: customers and the agent are for sales users only' };
const notAdmin = { description: 'Not an admin' };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const json = (schema) => ({ 'application/json': { schema } });
const ok = (description, schema) => ({ description, content: json(schema) });

export default {
  openapi: '3.0.3',
  info: { title: 'Customer API', version: '1.0.0', description: 'CRUD on customers plus an AI agent endpoint.' },
  tags: [{ name: 'Auth' }, { name: 'Admin' }, { name: 'Customers' }, { name: 'Agent' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  paths: {
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user (role is always sales) and log in',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: {
              name: { type: 'string', example: 'Sam Sales' },
              email: { type: 'string', example: 'sam@example.com' },
              password: { type: 'string', minLength: 8, example: 'changeme123' },
            },
          }),
        },
        responses: {
          201: ok('Registered; use the token in Authorize', authResponse),
          400: { description: 'Validation error' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in (sales users and the admin, e.g. admin@admin.com)',
        security: [],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', example: 'sam@example.com' },
              password: { type: 'string', example: 'changeme123' },
            },
          }),
        },
        responses: { 200: ok('Logged in', authResponse), 401: { description: 'Invalid email or password' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user',
        security: secured,
        responses: { 200: ok('Current user', user), 401: unauthorized },
      },
    },
    '/api/admin/users': {
      get: {
        tags: ['Admin'],
        security: secured,
        summary: 'List all users (sales and admin) with their customer counts',
        responses: { 200: ok('Users', { type: 'array', items: adminUser }), 401: unauthorized, 403: notAdmin },
      },
    },
    '/api/admin/stats': {
      get: {
        tags: ['Admin'],
        security: secured,
        summary: 'Totals for the admin dashboard',
        responses: { 200: ok('Stats', adminStats), 401: unauthorized, 403: notAdmin },
      },
    },
    '/api/customers': {
      get: {
        tags: ['Customers'],
        security: secured,
        summary: 'List your customers',
        parameters: [{ name: 'name', in: 'query', schema: { type: 'string' }, description: 'Filter by name (contains)' }],
        responses: { 200: ok('Customers', { type: 'array', items: customer }), 401: unauthorized, 403: notSales },
      },
      post: {
        tags: ['Customers'],
        security: secured,
        summary: 'Create a customer',
        requestBody: { required: true, content: json({ ...input, required: ['customer_name', 'email'] }) },
        responses: { 201: ok('Created', customer), 400: { description: 'Validation error' }, 401: unauthorized, 403: notSales },
      },
    },
    '/api/customers/export': {
      get: {
        tags: ['Customers'],
        security: secured,
        summary: 'Export your customers to an Excel (.xlsx) file',
        description: 'Only your own customers are included; the optional name filter matches the list endpoint.',
        parameters: [{ name: 'name', in: 'query', schema: { type: 'string' }, description: 'Filter by name (contains)' }],
        responses: {
          200: {
            description: 'Excel workbook',
            content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } },
          },
          401: unauthorized,
          403: notSales,
        },
      },
    },
    '/api/customers/{id}': {
      get: {
        tags: ['Customers'],
        security: secured,
        summary: 'Get a customer by id',
        parameters: [idParam],
        responses: { 200: ok('Customer', customer), 401: unauthorized, 403: notSales, 404: { description: 'Not found, or not owned by the caller' } },
      },
      put: {
        tags: ['Customers'],
        security: secured,
        summary: 'Update a customer',
        parameters: [idParam],
        requestBody: { required: true, content: json(input) },
        responses: { 200: ok('Updated', customer), 401: unauthorized, 403: notSales, 404: { description: 'Not found, or not owned by the caller' } },
      },
      delete: {
        tags: ['Customers'],
        security: secured,
        summary: 'Delete a customer',
        parameters: [idParam],
        responses: { 200: ok('Deleted', customer), 401: unauthorized, 403: notSales, 404: { description: 'Not found, or not owned by the caller' } },
      },
    },
    '/api/agent': {
      post: {
        tags: ['Agent'],
        security: secured,
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
          401: unauthorized, 403: notSales,
          503: { description: 'ANTHROPIC_API_KEY not configured' },
        },
      },
    },
  },
};

const UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';

export const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Customer API - Swagger UI</title>
    <link rel="stylesheet" href="${UI}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${UI}/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: '/swagger.json', dom_id: '#swagger-ui', persistAuthorization: true });
    </script>
  </body>
</html>`;
