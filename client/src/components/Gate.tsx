import { useEffect, useState } from 'react';
import { login, register, siteStatus, type AuthResult, type SiteStatus } from '../api.js';
import { LogoMark, Wordmark } from './Logo.js';

const FEATURES = [
  { icon: '🎬', tone: 'gold', title: 'Watch together', text: 'Play YouTube into a room and everyone stays in sync.' },
  { icon: '🔊', tone: 'pink', title: 'Soundboard', text: 'Drop a sound into the chat with a single click.' },
  { icon: '✨', tone: 'cyan', title: 'Make it yours', text: 'A profile with your photo, details and your own colours.' },
];

interface Props {
  onAuthed: (res: AuthResult) => void;
  /** A message to show above the form (e.g. why you were signed out). */
  notice?: string | null;
}

/** The front door: chatting needs an account, so this is all you see until you log in. */
export function Gate({ onAuthed, notice }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [account, setAccount] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState<SiteStatus | null>(null);

  useEffect(() => {
    siteStatus().then(setSite).catch(() => setSite(null));
  }, []);
  // If the server turns us away after a good login (e.g. maintenance), stop spinning.
  useEffect(() => {
    if (notice) setBusy(false);
  }, [notice]);

  const signupClosed = site?.registrationOpen === false;
  const signupMode = mode === 'signup' && !signupClosed;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!account.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    try {
      const res = signupMode
        ? await register(account.trim(), email.trim(), password)
        : await login(account.trim(), password);
      onAuthed(res);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const message = error ?? notice ?? null;

  return (
    <div className="gate">
      <div className="connect-bubbles" aria-hidden="true">
        <span className="cb cb1">🎵</span>
        <span className="cb cb2">💬</span>
        <span className="cb cb3">🎬</span>
        <span className="cb cb4">😄</span>
        <span className="cb cb5">✨</span>
      </div>

      <div className="gate-inner">
        <section className="gate-hero">
          <div className="gate-logo">
            <LogoMark size={76} />
            <h1>
              <Wordmark />
            </h1>
          </div>
          <p className="gate-tag">Media Webchat, Reborn.</p>
          <ul className="gate-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className={`gf-ico tone-${f.tone}`} aria-hidden="true">{f.icon}</span>
                <div>
                  <b>{f.title}</b>
                  <span>{f.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <form className="gate-card" onSubmit={submit}>
          <div className="gate-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
            >
              Create account
            </button>
          </div>

          <h2>{signupMode ? 'Join QChat' : 'Welcome back'}</h2>
          <p className="gate-sub">
            {signupMode ? 'Pick a username and password to get started.' : 'Log in to start chatting.'}
          </p>

          {site?.maintenance && (
            <p className="gate-warn">QChat is down for maintenance. Only admins can log in right now.</p>
          )}
          {mode === 'signup' && signupClosed ? (
            <p className="gate-warn">Sign ups are closed right now. If you already have an account, log in instead.</p>
          ) : (
            <>
              <label>
                Username
                <input
                  autoFocus
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  autoComplete="username"
                  placeholder="Your username"
                />
              </label>
              {signupMode && (
                <label>
                  Email <span className="optional">(optional)</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                  />
                </label>
              )}
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={signupMode ? 'new-password' : 'current-password'}
                  placeholder={signupMode ? 'At least 6 characters' : 'Your password'}
                />
              </label>

              {message && <p className="pm-error">{message}</p>}
              <button type="submit" disabled={busy} className="gate-submit">
                {busy ? 'Please wait…' : signupMode ? 'Create my account' : 'Log in'}
              </button>
            </>
          )}
          {mode === 'signup' && signupClosed && message && <p className="pm-error">{message}</p>}
        </form>
      </div>
    </div>
  );
}
