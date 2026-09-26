"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseEventLogs, type Hex } from "viem";
import { useBalance, useConfig, useReadContract } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { arcGiftAbi } from "@/lib/abi";
import { formatUsdc } from "@/lib/amount";
import { claimSignerOf, parseClaimKey, signClaim } from "@/lib/claimKey";
import { selectNetwork } from "@/lib/network-context";
import { NETWORK_IDS, getNetwork, txUrl, type NetworkConfig, type NetworkId } from "@/lib/networks";
import { decryptMessage } from "@/lib/message";
import { duration, parseGiftId, useGift, useNow, type GiftData } from "@/lib/useGift";
import { clearClaimTx, loadClaimTx, saveClaimTx } from "@/lib/giftStore";
import { assertWalletOn } from "@/lib/wagmi";
import { NotDeployed } from "./NotDeployed";
import { GiftBox, type GiftState } from "./GiftBox";
import { GiftMessage, hasMessage } from "./GiftMessage";
import { Progress } from "./Progress";
import { Button, Notice, Spinner, errorMessage } from "./ui";
import { ConnectWallet, WrongNetwork, useWallet } from "./Wallet";

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** The link key from `#k=…`, read on the client only (the fragment never reaches a server). */
export function useLinkKey(): Hex | null | undefined {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  return hash === null ? undefined : parseClaimKey(hash);
}

/**
 * Gift pages carry their network in the URL. Make it the selected network too, so the navbar,
 * balance and wallet checks all agree with the gift being shown.
 */
export function useSyncNetwork(id: NetworkId) {
  useEffect(() => selectNetwork(id), [id]);
}

export function useGiftMessage(
  network: NetworkConfig,
  id: bigint | null,
  key: Hex | null | undefined,
  payload: Hex | undefined,
) {
  return useQuery({
    queryKey: ["message", network.id, id?.toString(), key, payload],
    enabled: !!key && !!payload && payload !== "0x",
    queryFn: () => decryptMessage(key!, payload!),
    staleTime: Infinity,
  });
}

export function ClaimView({ rawId, networkId }: { rawId: string; networkId: NetworkId }) {
  const network = getNetwork(networkId);
  useSyncNetwork(networkId);
  const id = parseGiftId(rawId);
  const key = useLinkKey();
  const { data: gift, notFound, isLoading, error } = useGift(network, id);
  const message = useGiftMessage(network, id, key, gift?.message);

  if (!network.giftContractAddress) {
    return (
      <div className="flex flex-col gap-4 pt-6">
        <NotDeployed network={network} />
        <OtherNetworks current={network} />
      </div>
    );
  }
  if (id === null) {
    return <Dead title="This gift doesn't exist" body="Check that you opened the full link you were sent." />;
  }
  if (notFound) {
    return (
      <Dead
        title="Gift not found on this network."
        body={`There's no gift #${rawId} on ${network.chainName}. If it was sent on another network, switch below.`}
        action={<OtherNetworks current={network} />}
      />
    );
  }
  if (error) return <Dead title="Couldn't load this gift" body={errorMessage(error)} retry />;
  if (isLoading || !gift || key === undefined) return <Loading />;
  if (key === null) {
    return (
      <Dead
        title="This link is incomplete"
        body="The part after # holds the key that unlocks the gift. Ask the sender to send the whole link again."
      />
    );
  }
  if (claimSignerOf(key) !== gift.claimSigner) {
    return <Dead title="This link doesn't match this gift" body="Ask the sender for the link again." />;
  }

  return <Claimable network={network} gift={gift} linkKey={key} message={message.data ?? null} />;
}

/** Buttons to load this same link (same id, same #key) on another network. */
function OtherNetworks({ current }: { current: NetworkConfig }) {
  const router = useRouter();
  const others = NETWORK_IDS.filter((n) => n !== current.id).map(getNetwork);
  return (
    <div className="flex w-full flex-col gap-2">
      {others.map((n) => (
        <Button
          key={n.id}
          variant="quiet"
          onClick={() => {
            const params = new URLSearchParams(window.location.search);
            params.set("network", n.id);
            router.replace(`${window.location.pathname}?${params}${window.location.hash}`);
          }}
        >
          Look on {n.chainName}
        </Button>
      ))}
    </div>
  );
}

type Phase = "idle" | "signing" | "confirming";

const OPEN_FAILED = "Couldn't open the gift. Please try again.";

/**
 * One action: "Open gift" sends the claim transaction (the contract checks the link signature and
 * transfers the recipient's USDC in that same call). The note and amount are revealed only from
 * a confirmed receipt, or — after a refresh — from the chain (hasClaimed + getClaims).
 */
function Claimable({
  network,
  gift,
  linkKey,
  message,
}: {
  network: NetworkConfig;
  gift: GiftData;
  linkKey: Hex;
  message: string | null;
}) {
  const config = useConfig();
  const now = useNow();
  const { address, isConnected, onRightChain } = useWallet(network);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<GiftState>("idle");
  // Set only from a confirmed receipt on this visit; drives the reveal animation.
  const [revealed, setRevealed] = useState<{ amount: bigint; hash: Hex } | null>(null);
  const busy = useRef(false);

  const claimed = useReadContract({
    address: network.giftContractAddress ?? undefined,
    abi: arcGiftAbi,
    functionName: "hasClaimed",
    args: address ? [gift.id, address] : undefined,
    chainId: network.chainId,
    query: { enabled: !!address },
  });
  const claims = useReadContract({
    address: network.giftContractAddress ?? undefined,
    abi: arcGiftAbi,
    functionName: "getClaims",
    args: [gift.id],
    chainId: network.chainId,
    query: { enabled: claimed.data === true && !revealed },
  });
  const gas = useBalance({ address, chainId: network.chainId, query: { enabled: !!address } });
  const lowGas = gas.data !== undefined && gas.data.value < 10n ** 15n; // < 0.001 USDC (18-dec native)

  // Claimable only renders client-side (the link key is read from the URL fragment), so storage is safe here.
  const storedHash = address ? loadClaimTx(network, gift.id, address) : undefined;
  // A claim sent earlier from this device that the chain doesn't show yet: wait for it rather than offer a second one.
  const resumeHash = claimed.data === false && phase === "idle" && !revealed ? storedHash : undefined;
  const resume = useQuery({
    queryKey: ["resume-claim", network.id, gift.id.toString(), resumeHash],
    enabled: !!resumeHash,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const receipt = await waitForTransactionReceipt(config, { chainId: network.chainId, hash: resumeHash! });
        if (receipt.status === "success") {
          await claimed.refetch();
          return "success" as const;
        }
      } catch {}
      clearClaimTx(network, gift.id, address!);
      return "failed" as const;
    },
  });

  const isGroup = gift.recipients > 1;
  const isSender = address?.toLowerCase() === gift.sender.toLowerCase();
  const openWithin = duration(gift.expiresAt - (now || gift.createdAt));

  async function open() {
    if (busy.current || !address || !network.giftContractAddress) return;
    busy.current = true;
    const contract = network.giftContractAddress;
    const chainId = network.chainId;
    setError(null);
    setPhase("signing");
    try {
      await assertWalletOn(network);
      const signature = await signClaim(linkKey, { chainId, contract, giftId: gift.id, recipient: address });
      const { request } = await simulateContract(config, {
        chainId,
        account: address,
        address: contract,
        abi: arcGiftAbi,
        functionName: "claim",
        args: [gift.id, address, signature],
      });
      await assertWalletOn(network); // re-checked right before the wallet prompt
      const hash = await writeContract(config, request);
      saveClaimTx(network, gift.id, address, hash);
      setPhase("confirming");
      const receipt = await waitForTransactionReceipt(config, { chainId, hash });
      if (receipt.status !== "success") {
        clearClaimTx(network, gift.id, address);
        throw new Error(OPEN_FAILED);
      }
      const event = parseEventLogs({ abi: arcGiftAbi, eventName: "GiftClaimed", logs: receipt.logs }).find(
        (e) =>
          e.address.toLowerCase() === contract.toLowerCase() &&
          e.args.giftId === gift.id &&
          e.args.recipient.toLowerCase() === address.toLowerCase(),
      );
      if (!event) throw new Error(OPEN_FAILED);
      setBox("opening");
      await new Promise((r) => setTimeout(r, 900));
      setRevealed({ amount: event.args.amount, hash });
      setBox("open");
      void claimed.refetch();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("idle");
      busy.current = false;
    }
  }

  // ---- opened (claimed on-chain): from this visit's receipt, or from the chain after a refresh
  if (revealed ? box === "open" : claimed.data === true) {
    const mine = claims.data?.find((c) => c.recipient.toLowerCase() === address?.toLowerCase());
    const amount = revealed?.amount ?? mine?.amount;
    const hash = revealed?.hash ?? storedHash;
    const explorer = hash ? txUrl(network, hash) : undefined;
    return (
      <div className="flex flex-1 flex-col items-center text-center" data-testid="gift-opened">
        <div className="pt-4 pb-2">
          <GiftBox state="open" size={220} />
        </div>
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance">You opened your gift! 🎉</h1>
        {hasMessage(message) && (
          <div className="reveal-note w-full">
            <GiftMessage text={message} />
          </div>
        )}
        <p className="mt-8 text-muted">{isGroup ? "Your share" : "Your gift"}</p>
        <p
          className="reveal-amount tabular mt-1 text-[3.4rem] leading-none font-extrabold tracking-tight"
          data-testid="claimed-amount"
        >
          {amount === undefined ? "…" : formatUsdc(amount)}
          <span className="ml-2 text-2xl font-bold text-muted">USDC</span>
        </p>
        <p className="mt-3 text-[17px] font-semibold text-muted">✓ Sent to your wallet</p>
        <div className="mt-10 flex w-full flex-col gap-2">
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 items-center justify-center rounded-full bg-ink text-[17px] font-semibold text-tissue hover:opacity-90"
            >
              View transaction
            </a>
          )}
          <Link
            href="/create"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface font-semibold ring-1 ring-line hover:ring-muted"
          >
            Send a gift of your own
          </Link>
        </div>
      </div>
    );
  }
  // Wait for the chain before offering "Open gift" to a wallet that may already have opened it.
  if (address && claimed.isLoading) return <Loading />;

  const inFlight = phase !== "idle" || box === "opening" || resume.isLoading;
  if (!inFlight) {
    if (gift.status === "soldOut") {
      return (
        <Dead
          title="All gifts have been opened"
          body={`${isGroup ? `All ${gift.recipients} gifts in this link have been claimed.` : "This gift has been claimed."} If you opened it, connect that wallet to see it.`}
        />
      );
    }
    if (gift.status === "expired") {
      return <Dead title="This gift has expired" body="It can't be opened anymore. Unopened USDC goes back to the sender." />;
    }
    if (gift.status === "reclaimed") {
      return <Dead title="This gift was taken back" body="The sender reclaimed it after it expired." />;
    }
  }

  const label =
    phase === "confirming" || resume.isLoading ? "Confirming transaction…" : inFlight ? "Opening gift…" : "Open gift";
  const shownError = error ?? (resume.data === "failed" ? OPEN_FAILED : null);

  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <div className="pt-4 pb-2">
        <GiftBox state={box} size={220} />
      </div>
      <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-balance">You received a gift</h1>
      {isGroup && (
        <div className="mt-6 w-full">
          <Progress gift={gift} compact />
        </div>
      )}
      <div className="mt-7 flex w-full flex-col gap-3">
        {lowGas && !inFlight && (
          <Notice>
            You need a little USDC for the network fee.{" "}
            {network.id === "testnet" && (
              <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                Get testnet USDC
              </a>
            )}
          </Notice>
        )}
        {isSender && !inFlight && <Notice>This is your own gift. Opening it uses up one of the slots.</Notice>}
        {!isConnected ? (
          <ConnectWallet label="Connect wallet to open" />
        ) : !onRightChain ? (
          <WrongNetwork network={network} />
        ) : (
          <Button className="min-h-14 w-full text-[17px]" disabled={inFlight} onClick={open}>
            {inFlight && <Spinner />}
            <span key={label}>{label}</span>
          </Button>
        )}
        {shownError && <Notice tone="error">{shownError}</Notice>}
      </div>
      <p className="mt-4 text-sm text-muted">{openWithin ? `⏳ Open within ${openWithin}` : "Expired"}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center pt-4 text-center" aria-busy>
      <GiftBox state="still" size={220} />
      <p className="mt-4 text-muted">Finding your gift…</p>
    </div>
  );
}

function Dead({ title, body, retry, action }: { title: string; body: string; retry?: boolean; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center pt-6 text-center">
      <div className="opacity-50 grayscale">
        <GiftBox state="still" size={160} />
      </div>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-[34ch] text-muted">{body}</p>
      {action && <div className="mt-6 w-full">{action}</div>}
      <div className="mt-8 flex w-full flex-col gap-2">
        {retry && (
          <Button variant="quiet" onClick={() => window.location.reload()}>
            Try again
          </Button>
        )}
        <Link
          href="/create"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface font-semibold ring-1 ring-line hover:ring-muted"
        >
          Send a gift of your own
        </Link>
      </div>
    </div>
  );
}
