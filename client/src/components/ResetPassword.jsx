import { useState } from 'react';
import { api } from '../api';

// Opened from an emailed reset link (/?reset=TOKEN). On success the person is signed in.
export default function ResetPassword({ token, onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      const { user } = await api.resetPassword(token, password);
      onDone(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card card auth-form" onSubmit={handleSubmit}>
        <div className="auth-brand"><span className="brand-mark">♫</span> Funklist</div>
        <h1 className="auth-title">Choose a new password</h1>
        <label className="field">
          <span className="label">New password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={8} maxLength={200} autoComplete="new-password" autoFocus />
          <span className="muted small-text">8 to 200 characters. You’ll be signed out on other devices.</span>
        </label>
        <label className="field">
          <span className="label">Confirm new password</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            required autoComplete="new-password" />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Set password and sign in'}</button>
        <button type="button" className="link inline" onClick={onCancel}>Back to sign in</button>
      </form>
    </div>
  );
}
