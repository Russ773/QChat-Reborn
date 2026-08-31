/**
 * QChat Reborn logo: a homage to the two classic QChat logos, fused together.
 *  - the glossy blue orb + gold orbital ring (from the old QChat.co.uk logo)
 *  - sitting inside the green-to-yellow speech bubble (from "QChat Media Webchat")
 *
 * Pure inline SVG so it stays crisp at any size with no image assets. Gradient
 * ids are scoped per instance so multiple marks on a page do not collide.
 */
let seq = 0;

export function LogoMark({ size = 34 }: { size?: number }) {
  const n = (seq += 1);
  const orb = `qc-orb-${n}`;
  const gold = `qc-gold-${n}`;
  const bubble = `qc-bub-${n}`;
  const gloss = `qc-gloss-${n}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="logo-mark"
    >
      <defs>
        <radialGradient id={orb} cx="38%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#e2f5ff" />
          <stop offset="42%" stopColor="#2f8ae6" />
          <stop offset="100%" stopColor="#08377d" />
        </radialGradient>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe982" />
          <stop offset="55%" stopColor="#f5b021" />
          <stop offset="100%" stopColor="#d5860a" />
        </linearGradient>
        <linearGradient id={bubble} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#7ed957" />
          <stop offset="100%" stopColor="#ffe047" />
        </linearGradient>
        <radialGradient id={gloss} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* green -> yellow speech bubble (Media Webchat) */}
      <path
        d="M19 5 H45 Q59 5 59 19 V32 Q59 46 45 46 H27 L13 59 L20 46 H19 Q5 46 5 32 V19 Q5 5 19 5 Z"
        fill={`url(#${bubble})`}
      />

      {/* gold orbital ring, behind the orb so it reads as a ringed planet */}
      <g transform="rotate(-24 32 25)">
        <ellipse cx="32" cy="25" rx="21" ry="7.6" fill="none" stroke={`url(#${gold})`} strokeWidth="2.9" />
      </g>

      {/* glossy blue orb (QChat.co.uk) */}
      <circle cx="32" cy="25" r="12.6" fill={`url(#${orb})`} />
      <ellipse cx="27.5" cy="19.8" rx="5.2" ry="3.2" fill={`url(#${gloss})`} />
    </svg>
  );
}

/** Wordmark: "QChat" solid, "Reborn" in the accent gradient. */
export function Wordmark() {
  return (
    <span className="wordmark">
      QChat <span className="brand-dim">Reborn</span>
    </span>
  );
}
