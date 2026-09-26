import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { buildGiftLink, claimSignerOf, CLAIM_TYPES, newClaimKey, parseClaimKey, signClaim } from "./claimKey";

describe("claim link", () => {
  it("round-trips the key through the URL fragment", () => {
    const { privateKey, signer } = newClaimKey();
    const link = buildGiftLink("https://gift.example/", "testnet", 42n, privateKey);
    const url = new URL(link);
    expect(url.pathname).toBe("/gift/42");
    expect(url.search).toBe("?network=testnet"); // key is never in the path or query string
    expect(new URL(buildGiftLink("https://gift.example", "mainnet", 7n, privateKey)).searchParams.get("network")).toBe(
      "mainnet",
    );
    const parsed = parseClaimKey(url.hash);
    expect(parsed).toBe(privateKey);
    expect(claimSignerOf(parsed!)).toBe(signer);
  });

  it("rejects malformed keys", () => {
    expect(parseClaimKey("")).toBeNull();
    expect(parseClaimKey("#k=123")).toBeNull();
    expect(parseClaimKey("#k=" + "z".repeat(64))).toBeNull();
  });

  it("keys are unique", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newClaimKey().privateKey));
    expect(keys.size).toBe(50);
  });

  it("signature recovers to the claim signer and binds recipient", async () => {
    const { privateKey, signer } = newClaimKey();
    const domain = {
      name: "ArcGift",
      version: "1",
      chainId: 5042002,
      verifyingContract: "0x00000000000000000000000000000000000000aa",
    } as const;
    const recipient = "0x00000000000000000000000000000000000000bb" as const;
    const signature = await signClaim(privateKey, {
      chainId: domain.chainId,
      contract: domain.verifyingContract,
      giftId: 7n,
      recipient,
    });
    const recovered = await recoverTypedDataAddress({
      domain,
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: { giftId: 7n, recipient },
      signature,
    });
    expect(recovered).toBe(signer);

    const other = await recoverTypedDataAddress({
      domain,
      types: CLAIM_TYPES,
      primaryType: "Claim",
      message: { giftId: 7n, recipient: "0x00000000000000000000000000000000000000cc" },
      signature,
    });
    expect(other).not.toBe(signer);
  });
});
