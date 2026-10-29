import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import DealForm from './DealForm.jsx';
import { STAGES, formatDate, formatINR } from './money.js';

const OPEN = ['lead', 'qualified', 'proposal'];
const sum = (deals, stages) => deals.filter((d) => stages.includes(d.stage)).reduce((t, d) => t + d.amount, 0);

export default function Deals({ customer, onClose }) {
  const [deals, setDeals] = useState([]);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {..} = edit
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError('');
      setDeals(await api.listDeals(customer.customer_id));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [customer.customer_id]);

  useEffect(() => { load(); }, [load]);

  async function save(values) {
    if (editing.deal_id) await api.updateDeal(editing.deal_id, values);
    else await api.createDeal(customer.customer_id, values);
    setEditing(null);
    load();
  }

  async function changeStage(deal, stage) {
    const before = deals;
    setDeals(deals.map((d) => (d.deal_id === deal.deal_id ? { ...d, stage } : d)));
    try {
      await api.updateDeal(deal.deal_id, { stage });
    } catch (e) {
      setDeals(before);
      setError(e.message);
    }
  }

  async function remove(deal) {
    if (!window.confirm(`Delete deal "${deal.title}"?`)) return;
    try {
      await api.removeDeal(deal.deal_id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Deals: {customer.customer_name}</h2>

        <div className="deal-totals">
          <span>Open pipeline <strong>{formatINR(sum(deals, OPEN))}</strong></span>
          <span>Won <strong>{formatINR(sum(deals, ['won']))}</strong></span>
          <span>Lost <strong>{formatINR(sum(deals, ['lost']))}</strong></span>
        </div>

        {error && <div className="alert">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Title</th><th>Amount</th><th>Stage</th><th>Expected close</th><th /></tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.deal_id}>
                  <td>{d.title}</td>
                  <td>{formatINR(d.amount)}</td>
                  <td>
                    <select className={`stage stage-${d.stage}`} value={d.stage} onChange={(e) => changeStage(d, e.target.value)}>
                      {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td>{formatDate(d.expected_close_date)}</td>
                  <td className="actions">
                    <button className="btn" onClick={() => setEditing(d)}>Edit</button>
                    <button className="btn danger" onClick={() => remove(d)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && deals.length === 0 && (
                <tr><td colSpan="5" className="empty">No deals yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={() => setEditing({})}>+ Add deal</button>
        </div>
      </div>

      {editing && <DealForm deal={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}
