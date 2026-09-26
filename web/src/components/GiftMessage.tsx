/** True when the sender actually wrote something; empty or whitespace-only notes aren't shown. */
export function hasMessage(text: string | null | undefined): text is string {
  return !!text && text.trim() !== "";
}

/**
 * The sender's note as a small personal message tucked in with the gift: a soft bubble with a
 * subtle tail. The text is rendered verbatim (every newline and blank line kept); a short opening
 * line followed by more text reads as a greeting and is set semi-bold.
 */
export function GiftMessage({ text }: { text: string }) {
  const br = text.indexOf("\n");
  const split = br > 0 && br <= 40;

  return (
    <figure
      data-testid="gift-message"
      className="relative mx-auto mt-6 mb-2 flex min-h-24 w-full max-w-[480px] flex-col justify-center rounded-[20px] border border-line/70 bg-surface p-[22px] text-left shadow-[0_2px_10px_rgb(27_24_64/0.05)] sm:p-6 before:absolute before:-bottom-[6px] before:left-11 before:size-3 before:[transform:skewX(-18deg)_rotate(45deg)] before:rounded-br-[2px] before:border-r before:border-b before:border-line/70 before:bg-surface before:content-['']"
    >
      <blockquote className="text-base leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-line">
        {split ? (
          <>
            <span className="font-semibold">{text.slice(0, br)}</span>
            {text.slice(br)}
          </>
        ) : (
          text
        )}
      </blockquote>
    </figure>
  );
}
