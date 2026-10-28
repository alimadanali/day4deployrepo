import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const WRITE_TOOLS = ['add_customer', 'update_customer', 'delete_customer'];

export default function Chat({ onDataChanged }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! Ask me to list, find, add, update or delete customers.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    // The first message is a local greeting, not part of the conversation history.
    const history = messages.slice(1).filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    try {
      const { reply, toolCalls } = await api.chat(text, history);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      if (toolCalls.some((t) => WRITE_TOOLS.includes(t.name))) onDataChanged();
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: err.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card chat">
      <h2>Assistant</h2>
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.error ? ' error' : ''}`}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant typing">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          placeholder="e.g. Add customer John, john@example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn primary" disabled={busy}>Send</button>
      </form>
    </section>
  );
}
