import { STATUS_LABEL, type GiftStatus } from "@/lib/useGift";

const TONE: Record<GiftStatus, string> = {
  active: "bg-good/15 text-good",
  soldOut: "bg-box/15 text-box",
  expired: "bg-ribbon/25 text-ribbon-deep",
  reclaimed: "bg-line text-muted",
};

export function StatusBadge({ status }: { status: GiftStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${TONE[status]}`} data-testid="gift-status">
      {STATUS_LABEL[status]}
    </span>
  );
}
