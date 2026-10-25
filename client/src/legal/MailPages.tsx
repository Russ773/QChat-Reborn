import { useEffect, useState } from 'react';
import { confirmEmail, resetPassword } from '../api.js';
import { LogoMark, Wordmark } from '../components/Logo.js';

export type MailPageKind = 'reset' | 'verify';

/** Which email link page the address asks for, if any. */
export function mailPageKind(): MailPageKind | null {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '/reset-password' ? 'reset' : p === '/verify-email' ? 'verify' : null;
}

/** Read the link's token, then remove it from the address bar so it is not left in history or shared by accident. */
function takeToken(): string {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  try {
    window.history.replaceState(null, '', window.location.pathname);
  } catch {
    /* fine */
  }
  return token;
}

/** The pages that the links in QChat's emails open. */
export function MailPage({ kind }: { kind: MailPageKind }) {
  const [token] = useState(takeToken);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${kind === 'reset' ? 'Reset your password' : 'Confirm your email'} | QChat Reborn`;
  }, [kind]);

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      const r = await resetPassword(token, password);
      setDone(`Your password for ${r.account} has been changed. You can log in with it now.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await confirmEmail(token);
      setDone(`Thank you. ${r.email} is confirmed, and can be used to reset your password if you ever forget it.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="legal">
      <header className="legal-head">
        <a className="legal-brand" href="/" aria-label="Back to QChat">
          <LogoMark size={34} />
          <Wordmark />
        </a>
      </header>
      <main className="legal-body mail-page">
        {done ? (
          <>
            <h1>All done</h1>
            <p role="status">{done}</p>
            <p><a className="mail-link" href="/">Go to QChat</a></p>
          </>
        ) : !token ? (
          <>
            <h1>That link is not complete</h1>
            <p>Open the link from your email again, making sure the whole address is used. You can ask for a new one on the QChat log in page.</p>
            <p><a className="mail-link" href="/">Go to QChat</a></p>
          </>
        ) : kind === 'reset' ? (
          <form onSubmit={submitReset} className="mail-form">
            <h1>Choose a new password</h1>
            <p className="muted">At least 8 characters, and not an obvious one. Everywhere you are signed in will be signed out.</p>
            <label>
              New password
              <input type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              The same again
              <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            {error && <p className="pm-error" role="alert">{error}</p>}
            <button type="submit" disabled={busy || !password}>{busy ? 'Saving…' : 'Change my password'}</button>
          </form>
        ) : (
          <>
            <h1>Confirm your email address</h1>
            <p>Press the button to confirm that this email address is yours.</p>
            {error && <p className="pm-error" role="alert">{error}</p>}
            <button type="button" disabled={busy} onClick={() => void submitConfirm()}>{busy ? 'Confirming…' : 'Confirm my email'}</button>
          </>
        )}
      </main>
    </div>
  );
}
