import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { NetworkId } from "./networks";

/**
 * Claim-link keys.
 *
 * Each gift gets a fresh secp256k1 key. Its address is stored on-chain as `claimSigner`;
 * the private key only ever lives in the link's URL *fragment* (`#k=...`), which browsers
 * never send to servers. Whoever holds the link can sign `Claim(giftId, recipient)`, and
 * the signature pins the payout address so a front-runner can't redirect it.
 */

const KEY_RE = /^[0-9a-fA-F]{64}$/;

export function newClaimKey(): { privateKey: Hex; signer: Address } {
  const privateKey = generatePrivateKey(); // CSPRNG via @noble/curves
  return { privateKey, signer: privateKeyToAccount(privateKey).address };
}

/**
 * Full claim URL. The network is explicit so a Mainnet gift is never loaded against Testnet
 * (and vice versa); the key stays in the fragment.
 */
export function buildGiftLink(origin: string, network: NetworkId, giftId: bigint, privateKey: Hex): string {
  return `${origin.replace(/\/$/, "")}/gift/${giftId}?network=${network}#k=${privateKey.slice(2)}`;
}

/** Extract the claim key from `location.hash`. Returns null if missing or malformed. */
export function parseClaimKey(hash: string): Hex | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const k = params.get("k");
  return k && KEY_RE.test(k) ? (`0x${k.toLowerCase()}` as Hex) : null;
}

export function claimSignerOf(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}

export const CLAIM_TYPES = {
  Claim: [
    { name: "giftId", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

export function signClaim(
  privateKey: Hex,
  args: { chainId: number; contract: Address; giftId: bigint; recipient: Address },
): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: { name: "ArcGift", version: "1", chainId: args.chainId, verifyingContract: args.contract },
    types: CLAIM_TYPES,
    primaryType: "Claim",
    message: { giftId: args.giftId, recipient: args.recipient },
  });
}
