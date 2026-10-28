const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  list: (name) => request(`/api/customers${name ? `?name=${encodeURIComponent(name)}` : ''}`),
  create: (c) => request('/api/customers', { method: 'POST', body: JSON.stringify(c) }),
  update: (id, c) => request(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(c) }),
  remove: (id) => request(`/api/customers/${id}`, { method: 'DELETE' }),
  chat: (message, history) =>
    request('/api/agent', { method: 'POST', body: JSON.stringify({ message, history }) }),
};
