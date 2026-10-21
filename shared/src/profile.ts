/** A user's profile. Property names match the DB columns and the form fields. */
export interface Profile {
  account: string;
  displayName?: string;
  pronouns?: string;
  status?: string;
  age?: number;
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

export type ProfileFieldType = 'text' | 'textarea' | 'number' | 'select';

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

/** Validate an account/nick name: 2..24 chars, letters/digits/_-[]. */
export function validAccount(name: string): boolean {
  return /^[A-Za-z0-9_\-[\]]{2,24}$/.test(name);
}
