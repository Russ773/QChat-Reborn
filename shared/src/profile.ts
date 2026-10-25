/** A user's profile. Property names match the DB columns and the form fields. */
export interface Profile {
  account: string;
  displayName?: string;
  pronouns?: string;
  status?: string;
  age?: number;
  /** Month and day only, as MM-DD. Hidden unless the member ticks it under "Show on my profile". */
  birthday?: string;
  gender?: string;
  location?: string;
  timezone?: string;
  relationship?: string;
  lookingFor?: string;
  occupation?: string;
  interests?: string;
  favourites?: string;
  bio?: string;
  avatar?: string;
  accent?: string;
  updatedAt?: number;
}

export type ProfileFieldType = 'text' | 'textarea' | 'number' | 'select' | 'birthday';

export interface ProfileField {
  /** Profile property, DB column, and form field name (all the same). */
  key: keyof Profile;
  label: string;
  type: ProfileFieldType;
  max?: number;
  options?: string[];
  placeholder?: string;
}

/** The editable profile fields, used by the editor and server validation. */
export const PROFILE_FIELDS: ProfileField[] = [
  { key: 'displayName', label: 'Display name', type: 'text', max: 40 },
  { key: 'pronouns', label: 'Pronouns', type: 'text', max: 24, placeholder: 'e.g. they/them' },
  { key: 'status', label: 'Status', type: 'text', max: 100, placeholder: 'e.g. watching a film' },
  { key: 'age', label: 'Age', type: 'number' },
  { key: 'birthday', label: 'Birthday', type: 'birthday' },
  { key: 'gender', label: 'Gender', type: 'text', max: 32 },
  { key: 'location', label: 'Location', type: 'text', max: 80, placeholder: 'City, Country' },
  { key: 'timezone', label: 'Timezone', type: 'text', max: 48, placeholder: 'e.g. GMT' },
  {
    key: 'relationship',
    label: 'Relationship',
    type: 'select',
    options: ['', 'Single', 'In a relationship', 'Married', "It's complicated", 'Prefer not to say'],
  },
  { key: 'lookingFor', label: 'Looking for', type: 'text', max: 120, placeholder: 'e.g. friends & good chat' },
  { key: 'occupation', label: 'Occupation', type: 'text', max: 80 },
  { key: 'interests', label: 'Interests', type: 'text', max: 200, placeholder: 'music, gaming, coding…' },
  { key: 'favourites', label: 'Favourites', type: 'textarea', max: 240, placeholder: 'Favourite music, films, games…' },
  { key: 'bio', label: 'About', type: 'textarea', max: 500 },
];

/** Fields a user can choose to show or hide on their public profile. */
export const VISIBILITY_FIELDS: ProfileField[] = PROFILE_FIELDS.filter((f) => f.key !== 'displayName');

/** A user's display + privacy preferences. */
export interface ProfilePrefs {
  /** Per-field visibility; a field shows unless explicitly set to false. */
  visible: Record<string, boolean>;
  /** Whether other users may send this user private messages. */
  allowPm: boolean;
  /** Whether media shared in a room autoplays for this user. */
  autoplay: boolean;
  /** Dark, light, or follow the device. */
  theme: ThemeChoice;
  /** The accent colours (one of SKINS). */
  skin: string;
}

export type ThemeChoice = 'dark' | 'light' | 'auto';
export const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'auto', label: 'Match my device' },
];

/** The skins: a name, and two colours to show as its swatch. */
export const SKINS: { id: string; label: string; swatch: [string, string] }[] = [
  { id: 'default', label: 'Classic', swatch: ['#2b6bff', '#ff4d8d'] },
  { id: 'ocean', label: 'Ocean', swatch: ['#0ea5e9', '#14b8a6'] },
  { id: 'sunset', label: 'Sunset', swatch: ['#f97316', '#e11d74'] },
  { id: 'forest', label: 'Forest', swatch: ['#16a34a', '#a3e635'] },
  { id: 'midnight', label: 'Midnight', swatch: ['#6366f1', '#8b5cf6'] },
];

export function defaultPrefs(): ProfilePrefs {
  return { visible: {}, allowPm: true, autoplay: true, theme: 'dark', skin: 'default' };
}

/** Fields that stay private until the member chooses to show them. */
export const PRIVATE_BY_DEFAULT: readonly string[] = ['birthday'];

/** A field is visible by default (except those above); hidden only when explicitly set to false. */
export function fieldVisible(prefs: ProfilePrefs, field: string): boolean {
  return PRIVATE_BY_DEFAULT.includes(field) ? prefs.visible[field] === true : prefs.visible[field] !== false;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "03-14" for a real day of the year (29 February counts), else null. */
export function parseBirthday(raw: string): string | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "14 March" for "03-14". */
export function formatBirthday(md: string): string {
  const [m, d] = md.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1] ?? ''}`.trim();
}

export const BIRTHDAY_MONTHS = MONTH_NAMES;
export const BIRTHDAY_DAYS = DAYS_IN_MONTH;

/** Validate an account/nick name: 2..24 chars, letters/digits/_-[]. */
export function validAccount(name: string): boolean {
  return /^[A-Za-z0-9_\-[\]]{2,24}$/.test(name);
}
