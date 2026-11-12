/** "MCM" monogram in the hologram style: stroked letterforms inside HUD
 * corner brackets, with a light-blue gradient and glow. Drawn by hand as SVG,
 * so it stays crisp at any size and needs no font. */
export default function Logo({ height = 30 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 104 40"
      height={height}
      role="img"
      aria-label="MCM"
      className="logo"
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6f4ff" />
          <stop offset="0.55" stopColor="#7cc4ff" />
          <stop offset="1" stopColor="#3d9cf0" />
        </linearGradient>
        <filter id="logo-glow" x="-30%" y="-50%" width="160%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* HUD corner brackets */}
      <g className="logo-frame">
        <path d="M2,10 V2 H10" />
        <path d="M94,2 H102 V10" />
        <path d="M102,30 V38 H94" />
        <path d="M10,38 H2 V30" />
      </g>

      <g
        filter="url(#logo-glow)"
        fill="none"
        stroke="url(#logo-grad)"
        strokeWidth="3.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        {/* M */}
        <polyline points="12,30 12,10 21,23 30,10 30,30" />
        {/* C: an open ring, gap on the right. Slightly larger than the M's
            box so it reads the same height next to the M's sharp peaks. */}
        <path d="M60.1,11.9 A11.5,11.5 0 1 0 60.1,28.1" />
        {/* M */}
        <polyline points="74,30 74,10 83,23 92,10 92,30" />
      </g>

      {/* small accent tick under the C */}
      <line x1="47" y1="37.5" x2="57" y2="37.5" className="logo-tick" />
    </svg>
  );
}
