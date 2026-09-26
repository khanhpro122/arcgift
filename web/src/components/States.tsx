import Link from "next/link";

/** Friendly empty state with one clear next step. */
export function EmptyState({
  title,
  body,
  icon = "🎁",
  action = { href: "/create/group", label: "Create a gift" },
}: {
  title: string;
  body: string;
  icon?: string;
  action?: { href: string; label: string } | null;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl bg-surface px-6 py-10 text-center ring-1 ring-line" data-testid="empty-state">
      <span aria-hidden className="text-4xl">
        {icon}
      </span>
      <p className="mt-2 text-lg font-semibold">{title}</p>
      <p className="max-w-[30ch] text-sm leading-relaxed text-muted">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 font-semibold text-tissue hover:opacity-90"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Quiet placeholder rows while a list loads, shaped like the rows that will replace them. */
export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-busy aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 rounded-3xl bg-surface p-5 ring-1 ring-line">
          <span className="size-8 rounded-full bg-line" />
          <div className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-2/5 rounded-full bg-line" />
            <span className="h-2.5 w-1/4 rounded-full bg-line/70" />
          </div>
          <span className="h-3 w-14 rounded-full bg-line" />
        </div>
      ))}
    </div>
  );
}
