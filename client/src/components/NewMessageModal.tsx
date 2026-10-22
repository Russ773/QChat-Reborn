import { useState } from 'react';
import { validAccount } from '@qchat/shared';
import { getProfile } from '../api.js';

interface Props {
  me: string;
  onStart: (name: string) => void;
  onClose: () => void;
  /** Wording, so the same dialog serves "new message" and "add friend". */
  title?: string;
  blurb?: string;
  cta?: string;
  /** Refuse members who have turned private messages off (only for messaging). */
  needsPm?: boolean;
}

/** Pick a member by typing their name, checking they exist first. */
export function NewMessageModal({
  me,
  onStart,
  onClose,
  title = 'New message',
  blurb = 'Who do you want to message?',
  cta = 'Start chat',
  needsPm = true,
}: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim().replace(/^@/, '');
    if (!validAccount(n)) {
      setError('Enter a member name, like Jen.');
      return;
    }
    if (n.toLowerCase() === me.toLowerCase()) {
      setError('That is you.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await getProfile(n);
      if (!r.profile) {
        setError(`There is no member called "${n}".`);
      } else if (needsPm && !r.allowPm) {
        setError(`${r.profile.account} is not accepting private messages.`);
      } else {
        onStart(r.profile.account);
        onClose();
        return;
      }
    } catch {
      setError('Could not check that name. Try again.');
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-label={title}>
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">{title}</h2>
        <p className="dialog-msg">{blurb}</p>
        <label className="dialog-field">
          Member name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jen" maxLength={24} />
        </label>
        {error && <p className="pm-error">{error}</p>}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Checking…' : cta}</button>
        </div>
      </form>
    </div>
  );
}
