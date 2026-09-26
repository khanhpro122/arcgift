import type { Address, Hex } from "viem";
import type { NetworkConfig } from "./networks";

/**
 * Remembers claim keys on the sender's device so "My gifts" can show the link again.
 * Namespaced by network + chain + ArcGift contract, so Testnet and Mainnet never share entries.
 * The key is saved *before* the create transaction is sent (keyed by its signer address), so a
 * closed tab mid-flow never loses a funded link. Every access is guarded because storage can
 * be unavailable (private mode, blocked site data).
 */
type Store = { gifts: Record<string, Hex>; pending: Record<string, Hex> };

function storageKey(network: NetworkConfig) {
  return `arcgift:v2:${network.id}:${network.chainId}:${network.giftContractAddress ?? "none"}`;
}

function read(network: NetworkConfig): Store {
  try {
    const raw = localStorage.getItem(storageKey(network));
    if (raw) return JSON.parse(raw) as Store;
  } catch {}
  return { gifts: {}, pending: {} };
}

function write(network: NetworkConfig, store: Store) {
  try {
    localStorage.setItem(storageKey(network), JSON.stringify(store));
  } catch {}
}

export function savePendingKey(network: NetworkConfig, signer: Address, privateKey: Hex) {
  const s = read(network);
  s.pending[signer.toLowerCase()] = privateKey;
  write(network, s);
}

export function saveGiftKey(network: NetworkConfig, giftId: bigint, signer: Address, privateKey: Hex) {
  const s = read(network);
  s.gifts[giftId.toString()] = privateKey;
  delete s.pending[signer.toLowerCase()];
  write(network, s);
}

/** Look up a gift's key, adopting a pending key if its signer matches. */
export function findGiftKey(network: NetworkConfig, giftId: bigint, claimSigner: Address): Hex | undefined {
  const s = read(network);
  const known = s.gifts[giftId.toString()];
  if (known) return known;
  const pending = s.pending[claimSigner.toLowerCase()];
  if (pending) saveGiftKey(network, giftId, claimSigner, pending);
  return pending;
}

/**
 * Recipient side: the claim ("open") transaction this device sent for a gift, per wallet. Lets a
 * refresh resume a pending transaction instead of offering a second one, and link the confirmed
 * one. The chain (hasClaimed / getClaims) stays the source of truth for whether a gift was opened.
 */
function claimTxKey(network: NetworkConfig, giftId: bigint, recipient: Address) {
  return `${storageKey(network)}:claim:${giftId}:${recipient.toLowerCase()}`;
}

export function loadClaimTx(network: NetworkConfig, giftId: bigint, recipient: Address): Hex | undefined {
  try {
    return (localStorage.getItem(claimTxKey(network, giftId, recipient)) as Hex | null) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveClaimTx(network: NetworkConfig, giftId: bigint, recipient: Address, hash: Hex) {
  try {
    localStorage.setItem(claimTxKey(network, giftId, recipient), hash);
  } catch {}
}

export function clearClaimTx(network: NetworkConfig, giftId: bigint, recipient: Address) {
  try {
    localStorage.removeItem(claimTxKey(network, giftId, recipient));
  } catch {}
}
