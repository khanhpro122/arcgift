import Link from "next/link";
import { GiftBox } from "@/components/GiftBox";

const STEPS = [
  { title: "Create a gift", body: "Choose how much USDC to give and how many people can claim it." },
  { title: "Share one link or QR", body: "Send the gift link or scan the QR code. Each wallet can claim once." },
  {
    title: "Friends claim their share",
    // The contract doesn't auto-return funds: the sender reclaims what's left once the gift expires.
    body: "Everyone opens the gift and receives their USDC. After it expires, you can reclaim anything unclaimed.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center pt-6 text-center">
        <GiftBox size={200} />
        <h1 className="mt-6 text-[2.6rem] leading-[1.05] font-extrabold tracking-tight text-balance">
          Send USDC like a gift
        </h1>
        <p className="mt-4 max-w-[34ch] text-[17px] leading-relaxed text-muted">
          Create one gift link. Share it with your friends. Everyone can claim their share.
        </p>
        <div className="mt-8 flex w-full flex-col gap-2">
          <Link
            href="/create/group"
            className="inline-flex min-h-14 items-center justify-center rounded-full bg-ink text-[17px] font-semibold text-tissue hover:opacity-90"
          >
            Create a group gift
          </Link>
          <Link
            href="/create"
            className="inline-flex min-h-14 items-center justify-center rounded-full bg-surface text-[17px] font-semibold ring-1 ring-line hover:ring-muted"
          >
            Send to one person
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted">🎁 One link • Multiple people • USDC for everyone</p>
        <p className="mt-1 text-xs text-muted">Each wallet can claim once.</p>
      </section>

      <h2 id="how-it-works" className="mt-14 scroll-mt-28 text-lg font-bold tracking-tight">
        How it works
      </h2>
      <ol className="mt-4 flex flex-col gap-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-box/10 text-sm font-bold text-box">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{s.title}</p>
              <p className="text-[15px] leading-relaxed text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
