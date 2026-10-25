import { useEffect, useRef, useState } from 'react';
import { deleteCustomSound, uploadCustomSound, useCustomSounds } from '../media/customSounds.js';

const MAX_BYTES = 160 * 1024;

interface Props {
  token: string;
  onClose: () => void;
}

/** Add a short clip to the soundboard (an administrator approves it first), and manage your own. */
export function AddSoundModal({ token, onClose }: Props) {
  const { mine } = useCustomSounds(token);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔊');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!file) return setError('Choose an audio file first.');
    if (!name.trim()) return setError('Give the sound a name.');
    if (file.size > MAX_BYTES) return setError(`That clip is too big. Keep it short: under ${MAX_BYTES / 1024} KB, about 8 seconds.`);
    setBusy(true);
    try {
      await uploadCustomSound(token, file, name.trim(), emoji.trim() || '🔊');
      setDone(true);
      setName('');
      setFile(null);
      if (picker.current) picker.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-label="Add a sound">
        <button type="button" className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="modal-title">Add a sound</h2>
        <p className="dialog-msg">
          Upload a short clip (MP3, OGG, WAV, M4A or WebM, under {MAX_BYTES / 1024} KB, about 8 seconds). An admin listens to it and,
          if it is fine, it appears on everyone's soundboard. Please only share sounds you have the right to use.
        </p>
        <label className="dialog-field">
          Audio file
          <input ref={picker} type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="sound-name-row">
          <label className="dialog-field">
            Name
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Airhorn" />
          </label>
          <label className="dialog-field sound-emoji">
            Emoji
            <input value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
          </label>
        </div>
        {error && <p className="pm-error" role="alert">{error}</p>}
        {done && <p className="dialog-msg" role="status">Sent! You will see it on the soundboard once an admin approves it.</p>}
        <div className="pm-actions">
          <button type="button" className="secondary" onClick={onClose}>Close</button>
          <button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Send for approval'}</button>
        </div>

        {mine.length > 0 && (
          <div className="rs-section">
            <div className="rs-title">Your sounds ({mine.length} of 5)</div>
            {mine.map((s) => (
              <div className="rs-row" key={s.id}>
                <span>
                  {s.emoji} {s.name} <span className="rs-sub">{s.status === 'approved' ? 'on the soundboard' : 'waiting for approval'}</span>
                </span>
                <button type="button" className="mini" onClick={() => void deleteCustomSound(token, s.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
