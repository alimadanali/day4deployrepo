import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import CustomerForm from './CustomerForm.jsx';
import Chat from './Chat.jsx';

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {..} = edit
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError('');
      setCustomers(await api.list(search.trim()));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function save(values) {
    if (editing.customer_id) await api.update(editing.customer_id, values);
    else await api.create(values);
    setEditing(null);
    load();
  }

  async function remove(c) {
    if (!window.confirm(`Delete ${c.customer_name}?`)) return;
    try {
      await api.remove(c.customer_id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Customer Manager</h1>
        <span className="count">{customers.length} customers</span>
      </header>

      <main className="layout">
        <section className="card">
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn primary" onClick={() => setEditing({})}>
              + Add customer
            </button>
          </div>

          {error && <div className="alert">{error}</div>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customer_id}>
                    <td>{c.customer_id}</td>
                    <td>{c.customer_name}</td>
                    <td>{c.email}</td>
                    <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</td>
                    <td className="actions">
                      <button className="btn" onClick={() => setEditing(c)}>Edit</button>
                      <button className="btn danger" onClick={() => remove(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!loading && customers.length === 0 && (
                  <tr><td colSpan="5" className="empty">No customers found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <Chat onDataChanged={load} />
      </main>

      {editing && (
        <CustomerForm customer={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
