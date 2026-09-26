"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { NetworkId } from "@/lib/networks";
import { Button, Notice } from "./ui";

const SHARE_TEXT = "I sent you a gift 🎁 Open it here:";

/** Link, QR and share targets for a created gift. The QR encodes the full claim URL. */
export function SharePanel({
  id,
  link,
  networkId,
  compact = false,
}: {
  id: bigint;
  link: string;
  networkId: NetworkId;
  compact?: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1b1b3a", light: "#ffffff" } })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [link]);

  useEffect(() => {
    // Read after mount so server and client render the same markup.
    const t = setTimeout(() => setCanShare(typeof navigator.share === "function"), 0);
    return () => clearTimeout(t);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const encoded = encodeURIComponent(link);
  const text = encodeURIComponent(SHARE_TEXT);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 rounded-3xl bg-surface p-5 ring-1 ring-line">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated data: URL
          <img
            src={qr}
            alt={`QR code for gift #${id}`}
            width={compact ? 180 : 232}
            height={compact ? 180 : 232}
            className="rounded-xl"
            data-testid="gift-qr"
          />
        ) : (
          <div className="size-[232px] animate-pulse rounded-xl bg-line/60" />
        )}
        <p data-testid="gift-link" className="w-full text-center text-sm break-all text-muted select-all">
          {link}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button className="min-h-14 text-[17px]" onClick={copy}>
          {copied ? "Link copied" : "Copy link"}
        </Button>
      </div>
      <div className="-mt-2 flex flex-wrap gap-2 [&>*]:min-w-[30%] [&>*]:flex-1 [&>*]:px-3">
        {qr && (
          <a
            href={qr}
            download={`arc-gift-${networkId}-${id}.png`}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface px-4 text-[15px] font-semibold ring-1 ring-line hover:ring-muted"
          >
            Download QR
          </a>
        )}
        {canShare && (
          <Button
            variant="quiet"
            onClick={() => navigator.share({ title: "A gift for you", text: SHARE_TEXT, url: link }).catch(() => {})}
          >
            Share
          </Button>
        )}
        <a
          href={`https://t.me/share/url?url=${encoded}&text=${text}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface px-4 text-[15px] font-semibold ring-1 ring-line hover:ring-muted"
        >
          Telegram
        </a>
        <a
          href={`https://x.com/intent/post?text=${text}&url=${encoded}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface px-4 text-[15px] font-semibold ring-1 ring-line hover:ring-muted"
        >
          Post on X
        </a>
      </div>

      {!compact && (
        <Notice>
          Anyone with this link can open the gift, so share it only with the people you mean. It&apos;s saved on this device
          in{" "}
          <Link href={`/gift/${id}/manage?network=${networkId}`} className="font-semibold underline">
            gift #{id.toString()}
          </Link>
          .
        </Notice>
      )}
    </div>
  );
}
