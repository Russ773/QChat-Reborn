/** The same colour as text: darker on the light theme, so a name can be read on a pale page. */
export function nickInk(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return document.documentElement.dataset.theme === 'light' ? `hsl(${hue} 72% 34%)` : `hsl(${hue} 85% 66%)`;
}

/** Deterministic, vibrant colour for a nick, used for avatars and name tints. */
export function colorForNick(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 85% 66%)`;
}
