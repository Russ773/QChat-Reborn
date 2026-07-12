import { colorForNick } from '../colors.js';

interface Props {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}

/** An uploaded avatar image, or a colored letter fallback. */
export function Avatar({ name, src, size = 32, className = '' }: Props) {
  const dims = { width: size, height: size };
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
