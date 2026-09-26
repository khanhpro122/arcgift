import type { NextConfig } from "next";
import networks from "./src/config/networks.json";

// The only hosts the app talks to: each network's JSON-RPC (reads, receipts, logs). Wallet
// signing goes through the injected extension, not the network.
const rpcOrigins = Object.values(networks).map((n) => new URL(n.rpcUrl).origin);

// Production only: `next dev` needs eval and a websocket for hot reload. Sender link keys live
// in localStorage, so no third-party script may ever run here and nothing may be sent elsewhere.
const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap/hydration scripts; no remote scripts are allowed.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${rpcOrigins.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // E2E runs its own dev server in a separate build dir so it can coexist with `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Gift links carry their key in the URL fragment; never leak page URLs onward.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: csp }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
