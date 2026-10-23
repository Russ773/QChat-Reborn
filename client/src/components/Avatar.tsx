import { colorForNick } from '../colors.js';

interface Props {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
  /** A bot shows an emoji instead of a letter. */
  emoji?: string;
}

/** An uploaded avatar image, or a colored letter fallback. */
export function Avatar({ name, src, size = 32, className = '', emoji }: Props) {
  const dims = { width: size, height: size };
  if (emoji) {
    return (
      <span className={`avatar bot ${className}`} style={{ ...dims, fontSize: size * 0.55 }} aria-label={name}>
        {emoji}
      </span>
    );
  }
  if (src) {
    return <img className={`avatar img ${className}`} style={dims} src={src} alt={name} />;
  }
  return (
    <span
      className={`avatar ${className}`}
      style={{ ...dims, fontSize: size * 0.42, background: colorForNick(name) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
