"use client";

import { useState } from "react";
import { erc20Abi, parseEventLogs } from "viem";
import { useConfig, useReadContract } from "wagmi";
import { getBlock, readContract, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { arcGiftAbi } from "@/lib/abi";
import {
  MAX_RECIPIENTS,
  boundedRandomAllocations,
  checkBounds,
  fixedAllocations,
  newSeed,
  reachableMax,
  seededRandom,
  suggestBounds,
  validateBoundedAllocations,
} from "@/lib/allocation";
import { formatUsdc, parseUsdc } from "@/lib/amount";
import { buildGiftLink, newClaimKey } from "@/lib/claimKey";
import { useNetwork } from "@/lib/network-context";
import { saveGiftKey, savePendingKey } from "@/lib/giftStore";
import { assertWalletOn } from "@/lib/wagmi";
import { MAX_MESSAGE_CHARS, encryptMessage } from "@/lib/message";
import { NotDeployed } from "./NotDeployed";
import { SharePanel } from "./SharePanel";
import { Button, Notice, Spinner, errorMessage } from "./ui";
import { ConnectWallet, WrongNetwork, useWallet } from "./Wallet";

type Mode = "fixed" | "random";
type Step = "idle" | "approving" | "creating";

const HOUR = 3600;
const EXPIRY_PRESETS = [
  { label: "24 hours", seconds: 24 * HOUR },
  { label: "3 days", seconds: 72 * HOUR },
  { label: "7 days", seconds: 168 * HOUR },
  { label: "30 days", seconds: 720 * HOUR },
];
const MIN_EXPIRY = 10 * 60;
const MAX_EXPIRY = 365 * 24 * HOUR;

// Gas on Arc is paid in USDC from the same balance, so keep a little headroom.
const GAS_HEADROOM = 50_000n; // 0.05 USDC

/** Why the random min/max can't produce a valid split, or null if they can. */
function randomBoundsError(total: bigint | null, n: number, min: bigint | null, max: bigint | null): string | null {
  if (total === null || total <= 0n) return null;
  if (min === null) return "Enter a minimum like 1 or 0.50.";
  if (max === null) return "Enter a maximum like 20 or 12.50.";
  return checkBounds(total, n, min, max)?.message ?? null;
}

/**
 * Unix expiry for the chosen preset or custom date, relative to the chain's clock (the contract
 * checks bounds against block time, so a wrong device clock can't produce an invalid expiry).
 */
function computeExpiry(preset: number | "custom", customExpiry: string, now: number): number {
  if (preset !== "custom") return now + preset;
  const t = Math.floor(new Date(customExpiry).getTime() / 1000);
  if (!customExpiry || Number.isNaN(t)) throw new Error("Pick a custom expiry date and time.");
  if (t - now < MIN_EXPIRY + 60) throw new Error("A custom expiry must be at least 11 minutes from now.");
  if (t - now > MAX_EXPIRY) throw new Error("A custom expiry can be at most one year away.");
  return t;
}

export function GiftForm({ group }: { group: boolean }) {
  const config = useConfig();
  const { network } = useNetwork();
  const { address, isConnected, onRightChain } = useWallet(network);

  const [amountInput, setAmountInput] = useState("");
  const [people, setPeople] = useState(group ? 10 : 1);
  const [mode, setMode] = useState<Mode>(group ? "random" : "fixed");
  const [message, setMessage] = useState("");
  const [preset, setPreset] = useState<number | "custom">(EXPIRY_PRESETS[2].seconds);
  const [customExpiry, setCustomExpiry] = useState("");
  // Random mode: min/max inputs (null = follow the suggested defaults for this total/group size)
  const [minInput, setMinInput] = useState<string | null>(null);
  const [maxInput, setMaxInput] = useState<string | null>(null);
  // Secret seed for the random split; the preview is derived from it, so what's shown is exactly
  // what gets committed. "Shuffle again" just draws a new seed.
  const [seed, setSeed] = useState(newSeed);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: bigint; link: string; total: bigint } | null>(null);

  const recipients = group ? people : 1;
  const effectiveMode: Mode = recipients === 1 ? "fixed" : mode;
  const total = parseUsdc(amountInput);
  const messageLength = [...message].length;

  const balance = useReadContract({
    address: network.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: network.chainId,
    query: { enabled: !!address },
  });

  let problem: string | null = null;
  if (amountInput && total === null) problem = "Enter an amount like 25 or 12.50 (up to 6 decimals).";
  else if (total !== null && total < BigInt(recipients)) problem = "That's too little to split between everyone.";
  else if (total !== null && balance.data !== undefined && total + GAS_HEADROOM > balance.data)
    problem = `You have ${formatUsdc(balance.data)} USDC. Keep about 0.05 USDC for network fees.`;
  else if (messageLength > MAX_MESSAGE_CHARS) problem = `Keep the message under ${MAX_MESSAGE_CHARS} characters.`;

  const isRandom = effectiveMode === "random";
  const suggested = suggestBounds(total && total > 0n ? total : 100_000_000n, recipients);
  const minValue = minInput === null ? suggested.min : parseUsdc(minInput);
  const maxValue = maxInput === null ? suggested.max : parseUsdc(maxInput);
  const boundsError = isRandom ? randomBoundsError(total, recipients, minValue, maxValue) : null;
  // A typed max above what one person can get is valid (it never binds) but misleading — say so.
  const reach = isRandom && !boundsError && total && minValue !== null ? reachableMax(total, recipients, minValue) : null;
  const maxUnreachable = reach !== null && maxValue !== null && maxValue > reach ? reach : null;

  // Deterministic from (inputs, seed): cheap to recompute each render, and identical every time.
  const randomSplit =
    isRandom && total && minValue !== null && maxValue !== null && !boundsError
      ? boundedRandomAllocations(total, recipients, minValue, maxValue, seededRandom(seed))
      : null;

  const ready = total !== null && total > 0n && !problem && !boundsError && step === "idle";
  const split = total && total >= BigInt(recipients) ? fixedAllocations(total, recipients) : null;

  const createLabel =
    step === "approving"
      ? "Approving USDC…"
      : step === "creating"
        ? "Creating gift…"
        : `${group ? "Create group gift" : "Create gift"}${total ? ` · ${formatUsdc(total)} USDC` : ""}`;

  async function create() {
    if (!total || !address || !network.giftContractAddress) return;
    setError(null);
    const giftAddress = network.giftContractAddress;
    const chainId = network.chainId;
    try {
      const head = await getBlock(config, { chainId });
      const expiresAt = computeExpiry(preset, customExpiry, Number(head.timestamp));
      // Random split: the previewed array, re-derived from its seed and re-validated here, right
      // before sending. It's committed on-chain in the same tx as the deposit, and the contract
      // re-checks count, > 0 and exact sum.
      let allocations: bigint[] = [];
      if (isRandom) {
        if (minValue === null || maxValue === null || !randomSplit) throw new Error(boundsError ?? "Check the minimum and maximum.");
        const bad = checkBounds(total, recipients, minValue, maxValue);
        if (bad) throw new Error(bad.message);
        const recomputed = boundedRandomAllocations(total, recipients, minValue, maxValue, seededRandom(seed));
        if (recomputed.join() !== randomSplit.join()) throw new Error("The split changed. Review the preview and try again.");
        validateBoundedAllocations(randomSplit, total, recipients, minValue, maxValue);
        allocations = randomSplit;
      }
      const { privateKey, signer } = newClaimKey();
      const encrypted = await encryptMessage(privateKey, message);

      // Save the link key first: if anything below fails after funds move, it's recoverable.
      savePendingKey(network, signer, privateKey);

      const allowance = await readContract(config, {
        chainId,
        address: network.usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, giftAddress],
      });
      if (allowance < total) {
        setStep("approving");
        await assertWalletOn(network); // re-checked right before the wallet prompt
        // Exact-amount approval: no open-ended allowance is left behind.
        const approveHash = await writeContract(config, {
          chainId,
          address: network.usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [giftAddress, total],
        });
        const approval = await waitForTransactionReceipt(config, { chainId, hash: approveHash });
        if (approval.status !== "success") throw new Error("The USDC approval failed on-chain.");
      }

      setStep("creating");
      await assertWalletOn(network);
      const { request } = await simulateContract(config, {
        chainId,
        account: address,
        address: giftAddress,
        abi: arcGiftAbi,
        functionName: "createGift",
        args: [
          {
            mode: effectiveMode === "random" ? 1 : 0,
            totalAmount: total,
            recipients,
            allocations,
            expiresAt,
            claimSigner: signer,
            message: encrypted,
          },
        ],
      });
      await assertWalletOn(network);
      const hash = await writeContract(config, request);
      const receipt = await waitForTransactionReceipt(config, { chainId, hash });
      if (receipt.status !== "success") throw new Error("The gift transaction failed on-chain.");

      const [event] = parseEventLogs({ abi: arcGiftAbi, eventName: "GiftCreated", logs: receipt.logs });
      if (!event) throw new Error("The gift was created but its ID couldn't be read. Find it in My gifts.");
      const id = event.args.giftId;
      saveGiftKey(network, id, signer, privateKey);
      setCreated({ id, link: buildGiftLink(window.location.origin, network.id, id, privateKey), total });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStep("idle");
      balance.refetch();
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-6 pt-2">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">Gift created</h1>
          <p className="mt-2 text-muted">
            {formatUsdc(created.total)} USDC{group ? ` for ${recipients} people` : ""}. Send them this link or QR code.
          </p>
        </div>
        <SharePanel id={created.id} link={created.link} networkId={network.id} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{group ? "Group gift" : "Send a gift"}</h1>
        <p className="mt-1 text-muted">
          {group ? "One link. Everyone who opens it gets a share." : "Wrap USDC for one person."}
        </p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-semibold">{group ? "Total amount" : "Amount"}</span>
        <div className="flex items-center rounded-2xl bg-surface px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-box">
          <input
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="100"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="tabular min-w-0 flex-1 bg-transparent py-4 text-3xl font-bold outline-none placeholder:text-line"
          />
          <span className="text-lg font-semibold text-muted">USDC</span>
        </div>
        {balance.data !== undefined && (
          <span className="tabular text-sm text-muted">Balance: {formatUsdc(balance.data)} USDC</span>
        )}
      </label>

      {group && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold" id="people-label">
            People
          </span>
          <div className="flex items-center gap-3" role="group" aria-labelledby="people-label">
            <Stepper label="Fewer people" onClick={() => setPeople((n) => Math.max(2, n - 1))}>
              −
            </Stepper>
            <input
              name="people"
              aria-labelledby="people-label"
              inputMode="numeric"
              value={people}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, "")) || 2;
                setPeople(Math.min(MAX_RECIPIENTS, Math.max(2, n)));
              }}
              className="tabular w-20 rounded-2xl bg-surface py-3 text-center text-2xl font-bold ring-1 ring-line outline-none focus:ring-2 focus:ring-box"
            />
            <Stepper label="More people" onClick={() => setPeople((n) => Math.min(MAX_RECIPIENTS, n + 1))}>
              +
            </Stepper>
          </div>
          <p className="text-sm text-muted">
            Your gift is shared across the number of recipients you choose. Each wallet can claim once.
          </p>
        </div>
      )}

      {group && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Distribution</legend>
          <div className="grid grid-cols-2 gap-2">
            <Choice checked={mode === "random"} onChange={() => setMode("random")} title="Random">
              Everyone gets a surprise amount
            </Choice>
            <Choice checked={mode === "fixed"} onChange={() => setMode("fixed")} title="Fixed">
              Everyone gets the same
            </Choice>
          </div>
          {split && mode === "fixed" && (
            <p className="tabular text-sm text-muted">
              {recipients} × {formatUsdc(split[split.length - 1])} USDC
              {split[0] !== split[split.length - 1] && " (the first few get 0.000001 more so it adds up exactly)"}
            </p>
          )}
          {mode === "random" && (
            <div className="flex flex-col gap-4 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <BoundInput
                  label="Minimum per person"
                  name="min"
                  value={minInput ?? formatUsdc(suggested.min).replace(/,/g, "")}
                  onChange={setMinInput}
                />
                <BoundInput
                  label="Maximum per person"
                  name="max"
                  value={maxInput ?? formatUsdc(suggested.max).replace(/,/g, "")}
                  onChange={setMaxInput}
                />
              </div>
              {boundsError && <Notice tone="error">{boundsError}</Notice>}
              {maxUnreachable !== null && (
                <Notice>
                  <span>
                    With {recipients} people and a {formatUsdc(minValue!)} USDC minimum, nobody can get more than{" "}
                    {formatUsdc(maxUnreachable)} USDC.{" "}
                  </span>
                  <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => setMaxInput(formatUsdc(maxUnreachable).replace(/,/g, ""))}
                  >
                    Use {formatUsdc(maxUnreachable)}
                  </button>
                </Notice>
              )}
              {randomSplit && total && (
                <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line" data-testid="random-preview">
                  <ul className="tabular flex flex-wrap gap-1.5 text-sm" aria-label="Preview of amounts">
                    {randomSplit.map((a, i) => (
                      <li key={i} className="rounded-full bg-ribbon/20 px-2.5 py-1">
                        {formatUsdc(a)}
                      </li>
                    ))}
                  </ul>
                  <div className="tabular flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span data-testid="allocated-total">
                      Total allocated:{" "}
                      <span className="font-semibold">
                        {formatUsdc(randomSplit.reduce((a, b) => a + b, 0n))} / {formatUsdc(total)} USDC
                      </span>{" "}
                      {randomSplit.reduce((a, b) => a + b, 0n) === total && <span className="text-good">✓</span>}
                    </span>
                    <span className="text-muted">{recipients} recipients</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSeed(newSeed())}
                    className="self-start text-sm font-semibold text-box hover:underline"
                  >
                    Shuffle again
                  </button>
                </div>
              )}
              {!total && <p className="text-sm text-muted">Enter a total to preview the surprise amounts.</p>}
            </div>
          )}
        </fieldset>
      )}

      <label className="flex flex-col gap-2">
        <span className="font-semibold">
          Message <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          name="message"
          rows={3}
          placeholder={group ? "Thanks for being part of the community ❤️" : "Happy birthday! 🎂"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="resize-none rounded-2xl bg-surface p-4 text-[16px] leading-relaxed ring-1 ring-line outline-none placeholder:text-muted/60 focus:ring-2 focus:ring-box"
        />
        <span className="flex justify-between text-xs text-muted">
          <span>Only people with the link can read it.</span>
          <span className={`tabular ${messageLength > MAX_MESSAGE_CHARS ? "text-bad" : ""}`}>
            {messageLength}/{MAX_MESSAGE_CHARS}
          </span>
        </span>
      </label>

      <fieldset>
        <legend className="mb-2 font-semibold">Expires after</legend>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_PRESETS.map((o) => (
            <Pill key={o.seconds} pressed={preset === o.seconds} onClick={() => setPreset(o.seconds)}>
              {o.label}
            </Pill>
          ))}
          <Pill pressed={preset === "custom"} onClick={() => setPreset("custom")}>
            Custom
          </Pill>
        </div>
        {preset === "custom" && (
          <input
            type="datetime-local"
            aria-label="Custom expiry"
            value={customExpiry}
            onChange={(e) => setCustomExpiry(e.target.value)}
            className="mt-3 w-full rounded-2xl bg-surface p-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-box"
          />
        )}
        <p className="mt-2 text-sm text-muted">Anything unclaimed by then can be reclaimed by you.</p>
      </fieldset>

      {problem && <Notice tone="error">{problem}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {!network.giftContractAddress ? (
        <NotDeployed network={network} />
      ) : !isConnected ? (
        <ConnectWallet label="Connect wallet to continue" />
      ) : !onRightChain ? (
        <WrongNetwork />
      ) : (
        <div className="flex flex-col gap-2">
          <Button className="min-h-14 w-full text-[17px]" disabled={!ready} onClick={create}>
            {step !== "idle" && <Spinner />}
            <span key={createLabel}>{createLabel}</span>
          </Button>
          <p className="text-center text-xs text-muted">
            Your wallet asks you to approve USDC, then to confirm the gift.
          </p>
        </div>
      )}
    </div>
  );
}

function BoundInput(props: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{props.label}</span>
      <div className="flex items-center rounded-2xl bg-surface px-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-box">
        <input
          name={props.name}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="tabular min-w-0 flex-1 bg-transparent py-3 text-lg font-semibold outline-none"
        />
        <span className="text-sm font-semibold text-muted">USDC</span>
      </div>
    </label>
  );
}

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium ring-1 ${
        pressed ? "bg-ink text-tissue ring-ink" : "bg-surface ring-line hover:ring-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Stepper({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-12 items-center justify-center rounded-full bg-surface text-2xl ring-1 ring-line hover:ring-muted"
    >
      {children}
    </button>
  );
}

function Choice(props: { checked: boolean; onChange: () => void; title: string; children: string }) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-2xl p-4 ring-1 transition has-focus-visible:ring-2 has-focus-visible:ring-box ${
        props.checked ? "bg-box/10 ring-2 ring-box" : "bg-surface ring-line hover:ring-muted"
      }`}
    >
      <input type="radio" name="mode" className="sr-only" checked={props.checked} onChange={props.onChange} />
      <span className="font-semibold">{props.title}</span>
      <span className="text-sm leading-snug text-muted">{props.children}</span>
    </label>
  );
}
