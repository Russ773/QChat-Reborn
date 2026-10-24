/**
 * Message screening: the administrators' blocked words, and the "new members cannot post links yet" rule.
 * Administrators are never screened. Bots do not come through here (they speak with botSay).
 */
import { getSettings } from './settings.js';

/** Look-alike characters people use to get round a word list ("h3llo", "$hit"). */
const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '@': 'a', $: 's' };

const squash = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[01345@$]/g, (c) => LOOKALIKE[c])
    .replace(/\s+/g, ' ');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The compiled list is kept until the setting changes.
let cachedFor = '';
let cached: RegExp[] = [];

function wordList(raw: string): RegExp[] {
  if (raw !== cachedFor) {
    cachedFor = raw;
    cached = raw
      .split('\n')
      .map((w) => squash(w.trim()))
      .filter((w) => w.length > 0)
      .slice(0, 200)
      // Whole words only, so blocking "ass" does not catch "class".
      .map((w) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(w)}(?=$|[^a-z0-9])`));
  }
  return cached;
}

const LINK_RE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|uk|io|me|info|biz|xyz|ru|tk|gg|ly|tv|app|dev|link|click|top|cc|ws|to)\b/i;

/** Does this text contain something that looks like a link? */
export const hasLink = (text: string): boolean => LINK_RE.test(text);

/**
 * Why a member may not post this text, or null if it is fine. `ageMs` is how long ago their account was made.
 * The words are shown back to the sender, so keep them plain.
 */
export function screenText(text: string, ageMs: number, isAdmin: boolean): string | null {
  if (isAdmin) return null;
  const s = getSettings();
  const words = wordList(s.blockedWords);
  if (words.length > 0) {
    const t = ` ${squash(text)} `.trim();
    if (words.some((re) => re.test(t))) return 'That message was not sent because it contains a word that is not allowed here.';
  }
  const wait = s.newMemberLinkMinutes * 60_000;
  if (wait > 0 && ageMs < wait && hasLink(text)) {
    const left = Math.max(1, Math.ceil((wait - ageMs) / 60_000));
    return `New members cannot post links yet. Try again in about ${left} minute${left === 1 ? '' : 's'}.`;
  }
  return null;
}
