import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

export default function AdminDashboard({ user, onLogout }) {
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [desc, setDesc] = useState(true); // sort by customer count
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.adminUsers(), api.adminStats()])
      .then(([u, s]) => {
        setUsers(u);
        setStats(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => (desc ? b.customer_count - a.customer_count : a.customer_count - b.customer_count));
  }, [users, search, desc]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Admin Dashboard</h1>
        <div className="userbox">
          <span className="count">{user.name}</span>
          <button className="btn" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="admin">
        {error && <div className="alert">{error}</div>}

        {stats && (
          <div className="stats">
            <div className="card stat"><span>{stats.total_users}</span>Total users</div>
            <div className="card stat"><span>{stats.total_customers}</span>Total customers</div>
          </div>
        )}

        <section className="card">
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>
                    <button className="btn" onClick={() => setDesc((d) => !d)}>
                      Customers {desc ? '↓' : '↑'}
                    </button>
                  </th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.user_id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{u.customer_count}</td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="5" className="empty">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
