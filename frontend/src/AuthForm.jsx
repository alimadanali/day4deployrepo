import { useState } from 'react';
import { api } from './api.js';

export default function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAuth(
        registering
          ? await api.register(name.trim(), email.trim(), password)
          : await api.login(email.trim(), password),
      );
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={submit}>
        <h2>{registering ? 'Create account' : 'Log in'}</h2>
        {error && <div className="alert">{error}</div>}
        {registering && (
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>
          Password
          <input
            type="password"
            value={password}
            minLength={registering ? 8 : undefined}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="btn primary" disabled={busy}>{registering ? 'Register' : 'Log in'}</button>
        <button
          type="button"
          className="link"
          onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }}
        >
          {registering ? 'Have an account? Log in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}
