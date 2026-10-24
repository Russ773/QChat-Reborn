import { useEffect, useState } from 'react';
import { deleteMyAccount } from '../api.js';

interface Props {
  token: string;
  /** Administrators have to hand over the admin role first. */
  isAdmin: boolean;
  onClose: () => void;
  /** Called once the account is gone. */
  onDeleted: () => void;
}

/** Delete your own account for good. Needs your password. */
export function DeleteAccountModal({ token, isAdmin, onClose, onDeleted }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !done && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, done]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) return setError('Enter your password to confirm.');
    setBusy(true);
    try {
      await deleteMyAccount(token, password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={done ? undefined : onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-label="Delete my account">
        {!done && <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>}
        <h2 className="modal-title">Delete my account</h2>
        {done ? (
          <>
            <p className="dialog-msg">Your account has been deleted. Thank you for being part of QChat.</p>
            <div className="pm-actions">
              <button type="button" onClick={onDeleted}>Done</button>
            </div>
          </>
        ) : isAdmin ? (
          <>
            <p className="dialog-msg">
              You are an administrator, so you cannot delete your own account. Ask another administrator to remove
              your admin rights first.
            </p>
            <div className="pm-actions">
              <button type="button" className="secondary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-msg">This permanently deletes:</p>
            <ul className="delete-list">
              <li>your profile and photo</li>
              <li>your messages in rooms</li>
              <li>your private messages</li>
              <li>your pictures</li>
              <li>your friends list, reports and trivia scores</li>
            </ul>
            <p className="dialog-msg">It cannot be undone. Anything you delete disappears from our backups within 14 days. You can download a copy of your data first from the account menu.</p>
            <label className="dialog-field">
              Your password
              <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="pm-error">{error}</p>}
            <div className="pm-actions">
              <button type="button" className="secondary" onClick={onClose}>Keep my account</button>
              <button type="submit" className="danger" disabled={busy}>{busy ? 'Deleting…' : 'Delete everything'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
