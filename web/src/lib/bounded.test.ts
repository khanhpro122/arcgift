import { describe, expect, it } from "vitest";
import {
  boundedRandomAllocations,
  checkBounds,
  newSeed,
  seededRandom,
  reachableMax,
  suggestBounds,
  validateBoundedAllocations,
} from "./allocation";

const U = 1_000_000n; // 1 USDC in base units (6 decimals)
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** Asserts the core invariant: exact sum, right count, every share within [min, max]. */
function assertInvariant(a: bigint[], total: bigint, n: number, min: bigint, max: bigint) {
  expect(a).toHaveLength(n);
  expect(sum(a)).toBe(total);
  for (const x of a) {
    expect(x >= min, `${x} < min ${min}`).toBe(true);
    expect(x <= max, `${x} > max ${max}`).toBe(true);
  }
}

function repeat(times: number, total: bigint, n: number, min: bigint, max: bigint) {
  for (let i = 0; i < times; i++) assertInvariant(boundedRandomAllocations(total, n, min, max), total, n, min, max);
}

describe("boundedRandomAllocations — required cases", () => {
  it("1. total 100, n 10, min 1, max 20 (1,000 runs)", () => repeat(1000, 100n * U, 10, 1n * U, 20n * U));

  it("2. min == max == 10 → exactly 10 × 10", () => {
    for (let i = 0; i < 50; i++) expect(boundedRandomAllocations(100n * U, 10, 10n * U, 10n * U)).toEqual(Array(10).fill(10n * U));
  });

  it("3. total 100, n 10, min 5, max 20 (1,000 runs)", () => repeat(1000, 100n * U, 10, 5n * U, 20n * U));

  it("4. min × n == total → everyone gets min", () => {
    expect(boundedRandomAllocations(50n * U, 10, 5n * U, 20n * U)).toEqual(Array(10).fill(5n * U));
  });

  it("5. max × n == total → everyone gets max", () => {
    expect(boundedRandomAllocations(200n * U, 10, 1n * U, 20n * U)).toEqual(Array(10).fill(20n * U));
  });

  it("6. min × n > total is rejected", () => {
    expect(checkBounds(100n * U, 10, 11n * U, 20n * U)?.code).toBe("minTooHigh");
    expect(() => boundedRandomAllocations(100n * U, 10, 11n * U, 20n * U)).toThrow(/Minimum is too high/);
  });

  it("7. max × n < total is rejected", () => {
    expect(checkBounds(100n * U, 10, 1n * U, 9n * U)?.code).toBe("maxTooLow");
    expect(() => boundedRandomAllocations(100n * U, 10, 1n * U, 9n * U)).toThrow(/Maximum is too low/);
  });

  it("8. min > max is rejected", () => {
    expect(checkBounds(100n * U, 10, 12n * U, 11n * U)?.code).toBe("maxBelowMin");
  });

  it("9 & 10. sum exact and every share in bounds across many shapes (1,000 runs)", () => {
    for (let i = 0; i < 1000; i++) {
      const n = 1 + (i % 60);
      const min = BigInt(1 + (i % 7)) * 10_000n; // 0.01 – 0.07
      const max = min + BigInt((i * 7919) % 5_000_000) + 1n;
      const lo = min * BigInt(n);
      const hi = max * BigInt(n);
      const total = lo + ((hi - lo) * BigInt(i % 97)) / 96n; // anywhere in the feasible range
      assertInvariant(boundedRandomAllocations(total, n, min, max), total, n, min, max);
    }
  });

  it("11. shuffling gives different valid splits with the same constraints", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const a = boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U);
      assertInvariant(a, 100n * U, 10, 1n * U, 20n * U);
      seen.add(a.join(","));
    }
    expect(seen.size).toBeGreaterThan(15);
  });

  it("12. 6-decimal precision: non-cent totals and bounds stay exact to the base unit", () => {
    const total = 100_123_457n; // 100.123457
    const min = 1_000_001n; // 1.000001
    const max = 20_000_003n; // 20.000003
    for (let i = 0; i < 1000; i++) assertInvariant(boundedRandomAllocations(total, 10, min, max), total, 10, min, max);
  });

  it("uses whole cents when total and bounds are cent amounts", () => {
    for (const x of boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U)) expect(x % 10_000n).toBe(0n);
  });

  it("13. very small amounts: 1 USDC across 10, and 10 base units across 10", () => {
    repeat(1000, 1n * U, 10, 10_000n, 500_000n);
    expect(boundedRandomAllocations(10n, 10, 1n, 5n)).toEqual(Array(10).fill(1n));
    expect(checkBounds(9n, 10, 1n, 5n)?.code).toBe("minTooHigh");
  });

  it("14. different recipient counts, including 1 and the 200 maximum", () => {
    expect(boundedRandomAllocations(7n * U, 1, 1n * U, 20n * U)).toEqual([7n * U]);
    expect(checkBounds(30n * U, 1, 1n * U, 20n * U)?.code).toBe("maxTooLow");
    for (const n of [2, 3, 17, 50, 200]) repeat(50, BigInt(n) * 5n * U, n, 1n * U, 20n * U);
  });

  it("200 recipients stays fast", () => {
    const t = performance.now();
    for (let i = 0; i < 200; i++) boundedRandomAllocations(1_000n * U, 200, 1n * U, 20n * U);
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it("the leftover does not always land on the last person", () => {
    // min 1, max 20, total 100, n 10: without the shuffle the last slot is the forced remainder.
    const lastIsMax = Array.from({ length: 200 }, () => boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U)).map(
      (a) => a[9] === a.reduce((m, x) => (x > m ? x : m), 0n),
    );
    expect(lastIsMax.filter(Boolean).length).toBeLessThan(120);
  });
});

describe("validation and defaults", () => {
  it("rejects empty totals, zero minimum and bad people counts", () => {
    expect(checkBounds(0n, 10, 1n, 2n)?.code).toBe("total");
    expect(checkBounds(100n * U, 10, 0n, 20n * U)?.code).toBe("minZero");
    expect(checkBounds(100n * U, 0, 1n, 20n * U)?.code).toBe("people");
    expect(checkBounds(100n * U, 201, 1n, 20n * U)?.code).toBe("people");
  });

  it("error messages include the nearest valid limit", () => {
    expect(checkBounds(100n * U, 10, 11n * U, 20n * U)?.message).toContain("at most 10.00 USDC");
    expect(checkBounds(100n * U, 3, 1n * U, 20n * U)?.message).toContain("at least 33.333334 USDC");
  });

  it("defaults to 1–20 USDC when feasible", () => {
    expect(suggestBounds(100n * U, 10)).toEqual({ min: 1n * U, max: 20n * U });
  });

  it("never suggests a max nobody can reach, and follows the group size", () => {
    expect(suggestBounds(5n * U, 2)).toEqual({ min: 1n * U, max: 4n * U });
    expect(suggestBounds(5n * U, 3)).toEqual({ min: 1n * U, max: 3n * U });
    expect(suggestBounds(5n * U, 5)).toEqual({ min: 1n * U, max: 1n * U });
    expect(reachableMax(5n * U, 2, 1n * U)).toBe(4n * U);
    expect(reachableMax(5n * U, 6, 1n * U)).toBeNull();
  });

  it("adjusts defaults when 1–20 is impossible, and they are always valid", () => {
    const cases: [bigint, number][] = [
      [10n * U, 20], // 0.50 average: min 1 impossible
      [1000n * U, 10], // 100 average: max 20 impossible
      [1n * U, 200],
      [3n, 3],
      [1n * U, 1],
      [5_000n * U, 200],
    ];
    for (const [total, n] of cases) {
      const { min, max } = suggestBounds(total, n);
      expect(checkBounds(total, n, min, max), `${total}/${n} → ${min}-${max}`).toBeNull();
      assertInvariant(boundedRandomAllocations(total, n, min, max), total, n, min, max);
    }
  });

  it("validateBoundedAllocations catches every kind of tampering", () => {
    const good = [30n, 30n, 40n];
    expect(() => validateBoundedAllocations(good, 100n, 3, 30n, 40n)).not.toThrow();
    expect(() => validateBoundedAllocations([30n, 30n, 39n], 100n, 3, 30n, 40n)).toThrow(/sum/);
    expect(() => validateBoundedAllocations([29n, 31n, 40n], 100n, 3, 30n, 40n)).toThrow(/outside/);
    expect(() => validateBoundedAllocations([20n, 39n, 41n], 100n, 3, 20n, 40n)).toThrow(/outside/);
    expect(() => validateBoundedAllocations([50n, 50n], 100n, 3, 30n, 50n)).toThrow(/expected 3/);
  });
});

describe("seeded random stream", () => {
  it("same seed → same split (preview = committed); different seed → different split", () => {
    const seed = newSeed();
    const a = boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U, seededRandom(seed));
    const b = boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U, seededRandom(seed));
    const c = boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U, seededRandom(newSeed()));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("is not Math.random", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random must not be used");
    };
    try {
      boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U, seededRandom(newSeed()));
      boundedRandomAllocations(100n * U, 10, 1n * U, 20n * U);
    } finally {
      Math.random = original;
    }
  });
});
