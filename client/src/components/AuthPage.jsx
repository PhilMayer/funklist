import { useCallback, useState } from 'react';
import { api } from '../api';
import GoogleButton from './GoogleButton';

export default function AuthPage({ initialMode = 'signin', googleClientId, joining, onSignedIn, onHome }) {
  const [mode, setMode] = useState(initialMode); // 'signin' | 'register' | 'forgot'
  const [resetSent, setResetSent] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(form.username);
        setResetSent(true);
        setBusy(false);
        return;
      }
      const { user } = mode === 'signin'
        ? await api.login(form.username, form.password)
        : await api.register(form);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const handleGoogle = useCallback(async (credential) => {
    setError('');
    try {
      const { user } = await api.googleLogin(credential);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
    }
  }, [onSignedIn]);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setResetSent(false);
  };

  if (mode === 'forgot') {
    return (
      <div className="auth-wrap">
        <form className="auth-card card auth-form" onSubmit={handleSubmit}>
          <Brand onHome={onHome} />
          <h1 className="auth-title">Reset your password</h1>
          {resetSent ? (
            <p role="status">
              If an account matches, we’ve emailed it a reset link. It works once and expires in an hour.
              Accounts without an email address can’t be reset this way; Google accounts use “Continue with Google”.
            </p>
          ) : (
            <>
              <label className="field">
                <span className="label">Username or email</span>
                <input value={form.username} onChange={set('username')} required autoComplete="username"
                  autoCapitalize="none" spellCheck="false" autoFocus />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}</button>
            </>
          )}
          <button type="button" className="link inline" onClick={() => switchMode('signin')}>Back to sign in</button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <Brand onHome={onHome} />
        <p className="muted auth-tagline">
          {joining ? 'Sign in or create an account to join your band.' : 'Rehearsal and gig attendance for your band.'}
        </p>

        <div className="segmented auth-tabs">
          <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => switchMode('signin')}>
            Sign in
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>
            Create account
          </button>
        </div>

        {googleClientId && (
          <>
            <GoogleButton clientId={googleClientId} onCredential={handleGoogle} onError={setError} />
            <div className="divider"><span>or</span></div>
          </>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label className="field">
              <span className="label">Your name</span>
              <input
                value={form.display_name}
                onChange={set('display_name')}
                placeholder="How bandmates will see you"
                autoComplete="name"
              />
            </label>
          )}
          {mode === 'register' && (
            <label className="field">
              <span className="label">Email <span className="muted">(optional)</span></span>
              <input
                type="email"
                value={form.email}
                onChange={set('email')}
                placeholder="For new-event notifications"
                autoComplete="email"
              />
            </label>
          )}
          <label className="field">
            <span className="label">Username</span>
            <input
              value={form.username}
              onChange={set('username')}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
            />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && <span className="muted small-text">At least 8 characters.</span>}
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          {mode === 'signin' && (
            <button type="button" className="link inline forgot-link" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// The Funklist name at the top of the card; it goes back to the landing page.
function Brand({ onHome }) {
  const content = <><span className="brand-mark">♫</span> Funklist</>;
  if (!onHome) return <div className="auth-brand">{content}</div>;
  return (
    <button type="button" className="auth-brand" onClick={onHome} title="Back to the Funklist home page">
      {content}
    </button>
  );
}
