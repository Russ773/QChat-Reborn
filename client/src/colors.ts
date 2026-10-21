/** Deterministic, vibrant colour for a nick, used for avatars and name tints. */
export function colorForNick(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 85% 66%)`;
}
