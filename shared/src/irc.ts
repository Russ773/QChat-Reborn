/**
 * Minimal IRC message model + parser/serializer.
 *
 * Follows the RFC1459 grammar extended with IRCv3 message tags:
 *
 *   [ "@" tags SPACE ] [ ":" prefix SPACE ] command [ params ] CRLF
 *
 * Shared by both the server (ircd) and the browser client so the wire
 * format is defined in exactly one place.
 */

export type IrcTags = Record<string, string | true>;

export interface IrcMessage {
  /** IRCv3 message tags (`@key=value;key2` before the prefix). */
  tags?: IrcTags;
  /** Source: a servername or `nick!user@host`. Absent on client->server. */
  prefix?: string;
  /** Command verb (e.g. `PRIVMSG`) or a 3-digit numeric reply (e.g. `001`). */
  command: string;
  /** Command parameters. The final one may contain spaces (the "trailing"). */
  params: string[];
}

const TAG_UNESCAPE: Record<string, string> = {
  ':': ';',
  s: ' ',
  r: '\r',
  n: '\n',
  '\\': '\\',
};

const TAG_ESCAPE: Record<string, string> = {
  ';': '\\:',
  ' ': '\\s',
  '\r': '\\r',
  '\n': '\\n',
  '\\': '\\\\',
};

function unescapeTagValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      out += TAG_UNESCAPE[next] ?? next;
      i++;
    } else {
      out += value[i];
    }
  }
  return out;
}

function escapeTagValue(value: string): string {
  let out = '';
  for (const ch of value) out += TAG_ESCAPE[ch] ?? ch;
  return out;
}

/** Parse a single IRC line (without the trailing CRLF) into a message. */
export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.replace(/\r?\n$/, '');
  if (rest.length === 0) return null;

  const message: IrcMessage = { command: '', params: [] };

  // Tags
  if (rest.startsWith('@')) {
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return null;
    const tagStr = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1).replace(/^ +/, '');
    const tags: IrcTags = {};
    for (const pair of tagStr.split(';')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq === -1) {
        tags[pair] = true;
      } else {
        tags[pair.slice(0, eq)] = unescapeTagValue(pair.slice(eq + 1));
      }
    }
    message.tags = tags;
  }

  // Prefix
  if (rest.startsWith(':')) {
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return null;
    message.prefix = rest.slice(1, spaceIdx);
    rest = rest.slice(spaceIdx + 1).replace(/^ +/, '');
  }

  // Command + params
  const trailingIdx = rest.indexOf(' :');
  let trailing: string | undefined;
  if (rest.startsWith(':')) {
    // Whole remainder is trailing (unusual, but handle it).
    trailing = rest.slice(1);
    rest = '';
  } else if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  const parts = rest.split(' ').filter((p) => p.length > 0);
  if (parts.length === 0 && trailing === undefined) return null;
  message.command = (parts.shift() ?? '').toUpperCase();
  message.params = parts;
  if (trailing !== undefined) message.params.push(trailing);

  return message;
}

/** Serialize a message back into a single IRC line (no trailing CRLF). */
export function formatIrcMessage(message: IrcMessage): string {
  let out = '';

  if (message.tags) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(message.tags)) {
      parts.push(value === true ? key : `${key}=${escapeTagValue(value)}`);
    }
    if (parts.length) out += `@${parts.join(';')} `;
  }

  if (message.prefix) out += `:${message.prefix} `;

  out += message.command;

  const params = message.params;
  for (let i = 0; i < params.length; i++) {
    const param = params[i];
    const isLast = i === params.length - 1;
    // A param needs the trailing ":" form if it is empty, contains a space,
    // or starts with a colon.
    if (isLast && (param === '' || param.includes(' ') || param.startsWith(':'))) {
      out += ` :${param}`;
    } else {
      out += ` ${param}`;
    }
  }

  return out;
}

/** Extract the nickname from a `nick!user@host` prefix. */
export function nickFromPrefix(prefix: string | undefined): string | null {
  if (!prefix) return null;
  const bang = prefix.indexOf('!');
  return bang === -1 ? prefix : prefix.slice(0, bang);
}
