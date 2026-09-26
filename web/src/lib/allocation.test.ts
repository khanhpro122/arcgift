import { describe, expect, it } from "vitest";
import {
  CENT,
  fixedAllocations,
  randomAllocations,
  randomBigInt,
  validateAllocations,
  type RandomBytes,
} from "./allocation";
import { formatUsdc, parseUsdc } from "./amount";

const USDC = 1_000_000n;
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe("fixedAllocations (mirrors contract)", () => {
  it("splits evenly", () => {
    expect(fixedAllocations(100n * USDC, 10)).toEqual(Array(10).fill(10n * USDC));
  });
  it("odd division: remainder to first slots, exact sum", () => {
    const a = fixedAllocations(100n * USDC, 3);
    expect(a).toEqual([33_333_334n, 33_333_333n, 33_333_333n]);
    expect(sum(a)).toBe(100n * USDC);
  });
  it("1 recipient / 1 USDC / tiny", () => {
    expect(fixedAllocations(USDC, 1)).toEqual([USDC]);
    expect(fixedAllocations(3n, 3)).toEqual([1n, 1n, 1n]);
  });
  it("rejects invalid shapes", () => {
    expect(() => fixedAllocations(2n, 3)).toThrow();
    expect(() => fixedAllocations(USDC, 0)).toThrow();
    expect(() => fixedAllocations(USDC * 1000n, 201)).toThrow();
  });
});

describe("randomAllocations", () => {
  it("sums exactly and every slot > 0 across many runs", () => {
    for (let run = 0; run < 300; run++) {
      const n = 1 + (run % 50);
      const total = BigInt(n) * USDC + BigInt(run * 7919);
      const a = randomAllocations(total, n);
      expect(a).toHaveLength(n);
      expect(sum(a)).toBe(total);
      a.forEach((x) => expect(x > 0n).toBe(true));
    }
  });

  it("100 USDC / 10 produces distinct cent-rounded amounts", () => {
    const a = randomAllocations(100n * USDC, 10);
    expect(sum(a)).toBe(100n * USDC);
    a.forEach((x) => expect(x % CENT).toBe(0n));
    expect(new Set(a.map(String)).size).toBeGreaterThan(1);
  });

  it("every slot gets at least the 10% floor", () => {
    for (let i = 0; i < 100; i++) {
      const a = randomAllocations(100n * USDC, 10);
      a.forEach((x) => expect(x >= USDC).toBe(true)); // avg 10 → floor 1 USDC
    }
  });

  it("keeps sub-cent dust so sum is exact", () => {
    const total = 100n * USDC + 1234n;
    const a = randomAllocations(total, 7);
    expect(sum(a)).toBe(total);
  });

  it("falls back to base units for very small totals", () => {
    const a = randomAllocations(5n, 5);
    expect(a).toEqual([1n, 1n, 1n, 1n, 1n]);
    const b = randomAllocations(50_000n, 10); // 0.05 USDC across 10
    expect(sum(b)).toBe(50_000n);
  });

  it("1 recipient gets everything", () => {
    expect(randomAllocations(7_820_000n, 1)).toEqual([7_820_000n]);
  });

  it("handles large amounts without precision loss", () => {
    const total = 900_000_000_000n * USDC + 1n;
    const a = randomAllocations(total, 200);
    expect(sum(a)).toBe(total);
  });

  it("uses the injected CSPRNG, not Math.random", () => {
    let calls = 0;
    const rng: RandomBytes = (buf) => {
      calls++;
      return globalThis.crypto.getRandomValues(buf);
    };
    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random must not be used");
    };
    try {
      randomAllocations(100n * USDC, 10, { rng });
    } finally {
      Math.random = original;
    }
    expect(calls).toBeGreaterThanOrEqual(9);
  });

  it("randomBigInt stays in range and is roughly uniform", () => {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) counts[Number(randomBigInt(4n))]++;
    counts.forEach((c) => expect(c).toBeGreaterThan(800));
    expect(randomBigInt(0n)).toBe(0n);
  });
});

describe("validateAllocations", () => {
  it("rejects bad sums, zeros and wrong length", () => {
    expect(() => validateAllocations([1n, 2n], 4n, 2)).toThrow(/sum/);
    expect(() => validateAllocations([0n, 4n], 4n, 2)).toThrow(/> 0/);
    expect(() => validateAllocations([4n], 4n, 2)).toThrow(/expected/);
  });
});

describe("USDC amount parsing (6 decimals, no floats)", () => {
  it("parses", () => {
    expect(parseUsdc("100")).toBe(100n * USDC);
    expect(parseUsdc("7.82")).toBe(7_820_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("1,000.5")).toBe(1_000_500_000n);
    expect(parseUsdc(".5")).toBe(500_000n);
  });
  it("rejects garbage and > 6 decimals", () => {
    for (const bad of ["", "abc", "-1", "1e6", "0.0000001", "1.2.3"]) expect(parseUsdc(bad)).toBeNull();
  });
  it("formats", () => {
    expect(formatUsdc(7_820_000n)).toBe("7.82");
    expect(formatUsdc(100n * USDC)).toBe("100.00");
    expect(formatUsdc(33_333_334n)).toBe("33.333334");
    expect(formatUsdc(1_234_567n * USDC)).toBe("1,234,567.00");
    expect(formatUsdc(1n)).toBe("0.000001");
  });
});
