import { formatUsdc } from "@/lib/amount";
import type { GiftData } from "@/lib/useGift";

/** Live claim progress for a gift: how many opened, and how much USDC is left. */
export function Progress({ gift, compact = false }: { gift: GiftData; compact?: boolean }) {
  const left = gift.recipients - gift.claimedCount;
  const pct = Math.round((gift.claimedCount / gift.recipients) * 100);
  const remaining = gift.reclaimed ? 0n : gift.totalAmount - gift.claimedAmount;

  return (
    <div className="flex w-full flex-col gap-2 text-left" data-testid="gift-progress">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">
          <span className="tabular">
            {gift.claimedCount} / {gift.recipients}
          </span>{" "}
          opened
        </span>
        <span className="tabular text-muted">{left} left</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={gift.recipients}
        aria-valuenow={gift.claimedCount}
        aria-label="Gifts opened"
      >
        <div className="h-full rounded-full bg-ribbon transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <div className="tabular flex justify-between text-sm text-muted">
          <span>{formatUsdc(gift.claimedAmount)} USDC claimed</span>
          <span>{formatUsdc(remaining)} USDC remaining</span>
        </div>
      )}
    </div>
  );
}
