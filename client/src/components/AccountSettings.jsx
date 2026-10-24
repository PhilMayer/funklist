import { useState } from 'react';
import { api } from '../api';

// Signed-in account settings: the account email (where reset links go) and changing the password.
export default function AccountSettings({ user, onUserUpdated, onBack, onError }) {
  const [email, setEmail] = useState(user.email ?? '');
  const [emailSaved, setEmailSaved] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveEmail(e) {
    e.preventDefault();
    try {
      const { user: updated } = await api.updateAccount({ email });
      onUserUpdated(updated);
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2000);
    } catch (err) {
      onError(err.message);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMessage('');
    if (pw.next !== pw.confirm) return setPwError('The two new passwords don’t match.');
    setPwError('');
    setBusy(true);
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwMessage('Password changed. Your other devices have been signed out.');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const setField = (field) => (e) => setPw((p) => ({ ...p, [field]: e.target.value }));

  return (
    <section className="card form account">
      <button type="button" className="link" onClick={onBack}>← Back</button>
      <h1>Your account</h1>
      <p className="muted">
        Signed in as <strong>{user.username || user.display_name}</strong>
        {user.has_google && ' with Google'}.
      </p>

      <form className="account-section" onSubmit={saveEmail}>
        <h2>Email</h2>
        <p className="muted small-text">
          Where password reset links are sent. It’s also used for event emails in bands where your profile has no email.
        </p>
        <div className="row">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            autoComplete="email" aria-label="Account email" />
          <button type="submit" className="primary">{emailSaved ? 'Saved' : 'Save email'}</button>
        </div>
      </form>

      {user.has_password ? (
        <form className="account-section" onSubmit={changePassword}>
          <h2>Change password</h2>
          <label className="field">
            <span className="label">Current password</span>
            <input type="password" value={pw.current} onChange={setField('current')} required autoComplete="current-password" />
          </label>
          <label className="field">
            <span className="label">New password</span>
            <input type="password" value={pw.next} onChange={setField('next')} required minLength={8} maxLength={200}
              autoComplete="new-password" />
          </label>
          <label className="field">
            <span className="label">Confirm new password</span>
            <input type="password" value={pw.confirm} onChange={setField('confirm')} required autoComplete="new-password" />
          </label>
          {pwError && <p className="form-error" role="alert">{pwError}</p>}
          {pwMessage && <p className="saved-note" role="status">{pwMessage}</p>}
          <div className="form-actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          </div>
        </form>
      ) : (
        <p className="muted small-text">You sign in with Google, so there’s no Funklist password to change.</p>
      )}
    </section>
  );
}
