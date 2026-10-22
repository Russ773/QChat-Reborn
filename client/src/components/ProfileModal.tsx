import { useRef, useState } from 'react';
import { PROFILE_FIELDS, type Profile, type ProfileField } from '@qchat/shared';
import { Avatar } from './Avatar.js';

interface Props {
  account: string;
  profile: Profile | null;
  editable: boolean;
  onClose: () => void;
  onSave?: (patch: Partial<Profile>) => Promise<void>;
  onUploadAvatar?: (file: File) => Promise<string>;
  /** Start a private chat with this member (not shown on your own profile). */
  onMessage?: () => void;
  /** False when they have turned private messages off. */
  canMessage?: boolean;
}

const FACTS: (keyof Profile)[] = [
  'age', 'gender', 'location', 'timezone', 'relationship', 'lookingFor', 'occupation', 'interests',
];
const LABELS = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f.label]));

function initForm(p: Profile | null): Record<string, string> {
  const form: Record<string, string> = {};
  for (const f of PROFILE_FIELDS) {
    const v = p ? (p as unknown as Record<string, unknown>)[f.key] : undefined;
    form[f.key as string] = v == null ? '' : String(v);
  }
  return form;
}

export function ProfileModal({ account, profile, editable, onClose, onSave, onUploadAvatar, onMessage, canMessage = true }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() => initForm(profile));
  const [accent, setAccent] = useState(profile?.accent || '#7c8cff');
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(profile?.avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadAvatar) {
      setError(null);
      try {
        setAvatarUrl(await onUploadAvatar(file));
      } catch (err) {
        setError((err as Error).message);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const display = form.displayName || profile?.displayName || account;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!onSave) return;
    setBusy(true);
    setError(null);
    const patch: Record<string, string> = { accent };
    for (const f of PROFILE_FIELDS) patch[f.key as string] = form[f.key as string] ?? '';
    try {
      await onSave(patch as unknown as Partial<Profile>);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal profile-modal"
        style={{ ['--accent' as string]: accent } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Profile of ${account}`}
      >
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>

        <div className="pm-hero">
          <Avatar name={account} src={avatarUrl} size={96} className="pm-avatar" />
          {editing && onUploadAvatar && (
            <div className="pm-avatar-edit">
              <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
                Change photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={onFile}
              />
            </div>
          )}
          {editing ? (
            <input
              className="pm-name-input"
              value={form.displayName ?? ''}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="Display name"
              maxLength={40}
            />
          ) : (
            <h2 className="pm-name">{display}</h2>
          )}
          <div className="pm-sub">
            @{account}
            {!editing && profile?.pronouns ? ` · ${profile.pronouns}` : ''}
          </div>
          {!editing && profile?.status && <div className="pm-status">💬 {profile.status}</div>}
        </div>

        {editing ? (
          <div className="pm-form">
            {PROFILE_FIELDS.filter((f) => f.key !== 'displayName').map((f) => (
              <label key={f.key as string} className={f.type === 'textarea' ? 'pm-wide' : ''}>
                {f.label}
                <Field field={f} value={form[f.key as string] ?? ''} onChange={(v) => set(f.key as string, v)} />
              </label>
            ))}
            <label>
              Accent colour
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
            </label>
            {error && <p className="pm-error">{error}</p>}
            <div className="pm-actions">
              <button className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save profile'}</button>
            </div>
          </div>
        ) : (
          <div className="pm-view">
            {!profile && <p className="pm-empty">This user hasn't set up their profile yet.</p>}
            {profile && (
              <>
                {FACTS.some((k) => profile[k]) && (
                  <div className="pm-facts">
                    {FACTS.filter((k) => profile[k]).map((k) => (
                      <div className="fact" key={k}>
                        <span className="fact-label">{LABELS[k]}</span>
                        <span className="fact-value">{String(profile[k])}</span>
                      </div>
                    ))}
                  </div>
                )}
                {profile.favourites && <Row label="Favourites" value={profile.favourites} />}
                {profile.bio && <Row label="About" value={profile.bio} />}
              </>
            )}
            {editable && (
              <div className="pm-actions">
                <button onClick={() => setEditing(true)}>Edit profile</button>
              </div>
            )}
            {!editable && onMessage && (
              <div className="pm-actions pm-message">
                {!canMessage && <span className="pm-note">Not accepting private messages</span>}
                <button disabled={!canMessage} onClick={onMessage}>Send message</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ field, value, onChange }: { field: ProfileField; value: string; onChange: (v: string) => void }) {
  if (field.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>{o || 'Not set'}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return <textarea rows={2} value={value} maxLength={field.max} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'number') {
    return <input type="number" min={13} max={120} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input value={value} maxLength={field.max} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="pm-row">
      <span className="pm-row-label">{label}</span>
      <div className="pm-row-value">{value}</div>
    </div>
  );
}
