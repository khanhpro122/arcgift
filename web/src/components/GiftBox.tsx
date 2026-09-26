export type GiftState = "idle" | "opening" | "open" | "still";

/** The wrapped USDC present. `open` lifts the lid and bow and lets the light out. */
export function GiftBox({ state = "idle", size = 220 }: { state?: GiftState; size?: number }) {
  return (
    <svg
      className="gift mx-auto block overflow-visible"
      data-state={state}
      width={size}
      height={size}
      viewBox="0 0 220 220"
      role="img"
      aria-label={state === "open" ? "An opened gift box" : "A wrapped gift box"}
    >
      <defs>
        <linearGradient id="glow" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--ribbon)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--ribbon)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse cx="110" cy="204" rx="74" ry="8" fill="var(--ink)" opacity="0.08" />

      <path className="gift-glow" d="M52 104 L28 0 H192 L168 104 Z" fill="url(#glow)" />

      <g className="gift-body">
        {/* box */}
        <rect x="40" y="100" width="140" height="100" rx="10" fill="var(--box)" />
        <rect x="40" y="100" width="140" height="16" fill="var(--box-deep)" opacity="0.55" />
        <rect x="100" y="100" width="20" height="100" fill="var(--ribbon)" />
        <rect x="100" y="100" width="20" height="16" fill="var(--ribbon-deep)" opacity="0.6" />

        {/* lid */}
        <g className="gift-lid">
          <rect x="30" y="72" width="160" height="34" rx="9" fill="var(--box)" />
          <rect x="100" y="72" width="20" height="34" fill="var(--ribbon)" />
        </g>

        {/* bow */}
        <g className="gift-bow">
          <path
            d="M110 74 C92 40 58 44 64 62 C68 76 92 76 110 74 Z"
            fill="var(--ribbon)"
            stroke="var(--ribbon-deep)"
            strokeWidth="3"
          />
          <path
            d="M110 74 C128 40 162 44 156 62 C152 76 128 76 110 74 Z"
            fill="var(--ribbon)"
            stroke="var(--ribbon-deep)"
            strokeWidth="3"
          />
          <circle cx="110" cy="72" r="9" fill="var(--ribbon-deep)" />
        </g>
      </g>

      {/* sparkles */}
      <g fill="var(--ribbon)">
        <path className="sparkle" d="M60 30 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" />
        <path
          className="sparkle"
          style={{ ["--delay" as string]: "520ms" }}
          d="M166 20 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z"
        />
        <path
          className="sparkle"
          style={{ ["--delay" as string]: "680ms" }}
          d="M150 70 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z"
        />
      </g>
    </svg>
  );
}
