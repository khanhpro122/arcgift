import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-tissue hover:opacity-90 disabled:opacity-40",
  quiet: "bg-surface text-ink ring-1 ring-line hover:ring-muted disabled:opacity-40",
  danger: "bg-surface text-bad ring-1 ring-line hover:ring-bad disabled:opacity-40",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        tone === "error" ? "bg-bad/10 text-bad" : "bg-box/10 text-ink"
      }`}
    >
      {children}
    </p>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

const REVERT_COPY: Record<string, string> = {
  AlreadyClaimed: "This wallet has already opened this gift.",
  SoldOut: "Every gift in this link has already been opened.",
  GiftExpired: "This gift has expired.",
  GiftClosed: "The sender has taken this gift back.",
  GiftNotFound: "This gift doesn't exist.",
  InvalidSignature: "This link doesn't unlock this gift. Ask the sender for the full link.",
  GiftNotExpired: "You can reclaim this gift once it expires.",
  NotSender: "Only the wallet that created this gift can do that.",
  NothingToRefund: "There's nothing left to take back.",
  InvalidExpiry: "Pick an expiry between 10 minutes and 1 year from now.",
  InvalidAmount: "Every recipient needs at least 0.000001 USDC.",
  AllocationSumMismatch: "The split didn't add up to the total. Shuffle and try again.",
  ERC20InsufficientBalance: "Not enough USDC in this wallet.",
  ERC20InsufficientAllowance: "USDC approval is missing. Approve and try again.",
};

/** Turn a wallet/viem error into one plain sentence. */
export function errorMessage(err: unknown): string {
  if (!err) return "";
  let cur: unknown = err;
  while (cur && typeof cur === "object") {
    const name = (cur as { data?: { errorName?: string } }).data?.errorName;
    if (name) return REVERT_COPY[name] ?? `The transaction was rejected (${name}).`;
    cur = (cur as { cause?: unknown }).cause;
  }
  const e = err as { shortMessage?: string; message?: string };
  const text = `${e.shortMessage ?? ""}\n${e.message ?? String(err)}`;
  if (/user rejected|user denied|rejected the request/i.test(text)) return "Transaction cancelled. No changes were made.";
  if (/insufficient funds/i.test(text)) return "Not enough USDC in this wallet to pay for gas.";
  if (/does not match the target chain|chain mismatch|WrongNetworkError/i.test(text) || (err as Error).name === "WrongNetworkError") {
    return (err as Error).name === "WrongNetworkError"
      ? (err as Error).message
      : "Your wallet is on a different network. Switch networks and try again.";
  }
  const named = text.match(/Error: (\w+)\(/);
  if (named && REVERT_COPY[named[1]]) return REVERT_COPY[named[1]];
  if (/HTTP request failed|fetch failed|Failed to fetch|NetworkError|timed out|timeout/i.test(text)) {
    return "Couldn't reach the network. Check your connection and try again.";
  }
  // viem/wagmi errors carry a shortMessage: raw RPC/contract text, not something to show as-is.
  // Plain Errors are the app's own, already user-facing sentences.
  if (e.shortMessage) return "Something went wrong. Please try again.";
  return (e.message ?? String(err)).split("\n")[0];
}
