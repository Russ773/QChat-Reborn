import { useEffect, useState } from 'react';
import { changePassword } from '../api.js';

interface Props {
  token: string;
  onClose: () => void;
}

const MIN = 8;

/** Change your own password: current one, new one, and the new one again. */
export function PasswordModal({ token, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError('Enter your current password.');
    if (next.length < MIN) return setError(`Your new password must be at least ${MIN} characters.`);
    if (next !== again) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      await changePassword(token, current, next);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-label="Change password">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Change password</h2>
        {done ? (
          <>
            <p className="dialog-msg">
              Your password has been changed. Any other device you were logged in on has been logged out, and
              will need the new password.
            </p>
            <div className="pm-actions">
              <button type="button" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <label className="dialog-field">
              Current password
              <input type="password" autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="dialog-field">
              New password <span className="optional">(at least {MIN} characters)</span>
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="dialog-field">
              New password again
              <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            {error && <p className="pm-error">{error}</p>}
            <div className="pm-actions">
              <button type="button" className="secondary" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
