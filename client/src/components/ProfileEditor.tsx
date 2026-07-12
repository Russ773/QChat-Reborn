import { useRef, useState } from 'react';
import { PROFILE_LIMITS, type Profile } from '@qchat/shared';
import { saveProfile, uploadAvatar } from '../api.js';
import { Avatar } from './Avatar.js';

interface Props {
  token: string;
  account: string;
  profile: Profile | null;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}

export function ProfileEditor({ token, account, profile, onClose, onSaved }: Props) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [pronouns, setPronouns] = useState(profile?.pronouns ?? '');
  const [status, setStatus] = useState(profile?.status ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [links, setLinks] = useState((profile?.links ?? []).join('\n'));
  const [avatar, setAvatar] = useState<string | undefined>(profile?.avatar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > PROFILE_LIMITS.avatarBytes) {
      setError('Avatar too large (max 1 MB)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await uploadAvatar(token, file);
      setAvatar(updated.avatar);
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await saveProfile(token, {
        displayName,
        pronouns,
        status,
        bio,
        links: links
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit profile">
        <h2>Edit profile</h2>

        <div className="pe-avatar-row">
          <Avatar name={account} src={avatar} size={64} />
          <div>
            <button className="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              Upload avatar
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={pickAvatar}
            />
            <p className="pe-hint">PNG / JPG / WebP / GIF, up to 1 MB</p>
          </div>
        </div>

        <label>
          Display name
          <input
            value={displayName}
            maxLength={PROFILE_LIMITS.displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label>
          Pronouns
          <input
            value={pronouns}
            maxLength={PROFILE_LIMITS.pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            placeholder="e.g. they/them"
          />
        </label>
        <label>
          Status
          <input
            value={status}
            maxLength={PROFILE_LIMITS.status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="e.g. watching movies"
          />
        </label>
        <label>
          Bio
          <textarea value={bio} maxLength={PROFILE_LIMITS.bio} rows={3} onChange={(e) => setBio(e.target.value)} />
        </label>
        <label>
          Links (one per line)
          <textarea value={links} rows={3} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
        </label>

        {error && <p className="pe-error">{error}</p>}

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
