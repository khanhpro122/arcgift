import { describe, expect, it } from "vitest";
import { newClaimKey } from "./claimKey";
import { decryptMessage, encryptMessage } from "./message";

describe("gift message encryption", () => {
  it("round-trips with the link key, including emoji", async () => {
    const { privateKey } = newClaimKey();
    const text = "Happy Birthday! Hope you have an amazing day ❤️ — Khanh";
    const payload = await encryptMessage(privateKey, text);
    expect(payload).not.toContain(Buffer.from("Birthday").toString("hex"));
    expect(await decryptMessage(privateKey, payload)).toBe(text);
  });

  it("cannot be read with another key", async () => {
    const a = newClaimKey().privateKey;
    const b = newClaimKey().privateKey;
    expect(await decryptMessage(b, await encryptMessage(a, "secret"))).toBeNull();
  });

  it("empty message encodes to empty bytes", async () => {
    const { privateKey } = newClaimKey();
    expect(await encryptMessage(privateKey, "   ")).toBe("0x");
    expect(await decryptMessage(privateKey, "0x")).toBeNull();
  });

  it("fits the on-chain 1024 byte limit at max length", async () => {
    const { privateKey } = newClaimKey();
    const payload = await encryptMessage(privateKey, "😀".repeat(200)); // 4 bytes each
    expect((payload.length - 2) / 2).toBeLessThanOrEqual(1024);
    await expect(encryptMessage(privateKey, "a".repeat(201))).rejects.toThrow();
  });

  it("uses a fresh IV every time", async () => {
    const { privateKey } = newClaimKey();
    expect(await encryptMessage(privateKey, "hi")).not.toBe(await encryptMessage(privateKey, "hi"));
  });
});
