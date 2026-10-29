import { useState } from 'react';
import { STAGES } from './money.js';

export default function DealForm({ deal, onSave, onCancel }) {
  const [title, setTitle] = useState(deal.title || '');
  const [amount, setAmount] = useState(deal.amount ?? '');
  const [stage, setStage] = useState(deal.stage || 'lead');
  const [date, setDate] = useState(deal.expected_close_date || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        amount: Number(amount),
        stage,
        expected_close_date: date || null,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{deal.deal_id ? 'Edit deal' : 'New deal'}</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </label>
        <label>
          Amount (₹)
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label>
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>
          Expected close date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
