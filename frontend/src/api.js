const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const TOKEN_KEY = 'auth_token';

const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export const hasToken = () => !!storage.get();

async function request(path, options = {}) {
  const token = storage.get();
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    storage.clear();
    onUnauthorized();
  }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const authenticate = async (path, payload) => {
  const { token, user } = await request(path, { method: 'POST', body: JSON.stringify(payload) });
  storage.set(token);
  return user;
};

export const api = {
  register: (name, email, password) => authenticate('/api/auth/register', { name, email, password }),
  login: (email, password) => authenticate('/api/auth/login', { email, password }),
  me: () => request('/api/auth/me'),
  logout: () => storage.clear(),
  adminUsers: () => request('/api/admin/users'),
  adminStats: () => request('/api/admin/stats'),
  list: (name) => request(`/api/customers${name ? `?name=${encodeURIComponent(name)}` : ''}`),
  create: (c) => request('/api/customers', { method: 'POST', body: JSON.stringify(c) }),
  update: (id, c) => request(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(c) }),
  remove: (id) => request(`/api/customers/${id}`, { method: 'DELETE' }),
  chat: (message, history) =>
    request('/api/agent', { method: 'POST', body: JSON.stringify({ message, history }) }),
};
