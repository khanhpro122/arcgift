/**
 * Gift allocation math. All amounts are bigint base units (USDC ERC-20: 6 decimals).
 *
 * Random allocations are generated here with a CSPRNG (crypto.getRandomValues) *before*
 * the gift link exists, then committed on-chain in createRandomGift(). The contract
 * re-verifies every invariant (length, each > 0, exact sum), so this code decides the
 * shape of the split but can never make the contract pay out more than was deposited.
 *
 * Arc has no usable on-chain randomness (PREVRANDAO is always 0), which is why the split
 * is not derived on-chain.
 */

import { keccak256 } from "viem";

export const MAX_RECIPIENTS = 200; // mirrors ArcGift.MAX_RECIPIENTS
export const CENT = 10_000n; // 0.01 USDC

export type RandomBytes = (buf: Uint8Array) => Uint8Array;

const cryptoRandom: RandomBytes = (buf) => globalThis.crypto.getRandomValues(buf);

/** Uniform bigint in [0, max] using rejection sampling (no modulo bias). */
export function randomBigInt(max: bigint, rng: RandomBytes = cryptoRandom): bigint {
  if (max < 0n) throw new Error("max must be >= 0");
  if (max === 0n) return 0n;
  const bits = max.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const buf = rng(new Uint8Array(bytes));
    let x = 0n;
    for (const b of buf) x = (x << 8n) | BigInt(b);
    x &= mask;
    if (x <= max) return x;
  }
}

/** Mirror of ArcGift._allocationAt for Fixed mode: remainder goes +1 unit to the first slots. */
export function fixedAllocations(total: bigint, n: number): bigint[] {
  assertShape(total, n);
  const count = BigInt(n);
  const base = total / count;
  const remainder = total % count;
  return Array.from({ length: n }, (_, i) => (BigInt(i) < remainder ? base + 1n : base));
}

export type RandomOptions = {
  /** Round slots to this many base units when possible (default: 0.01 USDC). */
  granularity?: bigint;
  /** Guaranteed minimum for every slot, as a fraction of the average (default 10%). */
  floorPercent?: bigint;
  rng?: RandomBytes;
};

/**
 * Random split using the "broken stick" method: n-1 uniform cut points on the distributable
 * range, sorted, and the gaps become the allocations. Each slot also gets a floor so no one
 * opens a gift worth 0.01 out of 100.
 *
 * Guarantees: length n, every slot > 0, sum === total exactly.
 */
export function randomAllocations(total: bigint, n: number, opts: RandomOptions = {}): bigint[] {
  assertShape(total, n);
  const rng = opts.rng ?? cryptoRandom;
  const count = BigInt(n);

  // Work in cents when every slot can get at least one; fall back to base units otherwise.
  let granularity = opts.granularity ?? CENT;
  if (granularity < 1n) granularity = 1n;
  if (total / granularity < count) granularity = 1n;

  const units = total / granularity;
  const dust = total % granularity;

  const floorPercent = opts.floorPercent ?? 10n;
  let floor = (units * floorPercent) / (count * 100n);
  if (floor < 1n) floor = 1n;

  const distributable = units - floor * count;
  const cuts: bigint[] = [];
  for (let i = 0; i < n - 1; i++) cuts.push(randomBigInt(distributable, rng));
  cuts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const result: bigint[] = [];
  let prev = 0n;
  for (const cut of [...cuts, distributable]) {
    result.push((floor + (cut - prev)) * granularity);
    prev = cut;
  }

  // Sub-cent dust goes to a uniformly chosen slot so the sum stays exact.
  if (dust > 0n) {
    const lucky = Number(randomBigInt(count - 1n, rng));
    result[lucky] += dust;
  }

  validateAllocations(result, total, n);
  return result;
}

export function validateAllocations(allocations: bigint[], total: bigint, n: number): void {
  if (allocations.length !== n) throw new Error(`expected ${n} allocations, got ${allocations.length}`);
  let sum = 0n;
  allocations.forEach((a, i) => {
    if (a <= 0n) throw new Error(`allocation ${i} must be > 0`);
    sum += a;
  });
  if (sum !== total) throw new Error(`allocations sum ${sum} != total ${total}`);
}

function assertShape(total: bigint, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_RECIPIENTS) {
    throw new Error(`recipients must be between 1 and ${MAX_RECIPIENTS}`);
  }
  if (total < BigInt(n)) throw new Error("total must give every recipient at least 0.000001 USDC");
}

// ---------------------------------------------------------------------------------------------
// Bounded random split (creator-defined minimum and maximum per person)
// ---------------------------------------------------------------------------------------------

export type BoundsError =
  | { code: "people"; message: string }
  | { code: "total"; message: string }
  | { code: "minZero"; message: string }
  | { code: "maxBelowMin"; message: string }
  | { code: "minTooHigh"; message: string; limit: bigint }
  | { code: "maxTooLow"; message: string; limit: bigint };

const fmt = (units: bigint) => {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${frac}`;
};

/**
 * Checks that a split with every share in [min, max] can add up to exactly `total`:
 * min·n ≤ total ≤ max·n. Minimum must be > 0 because the ArcGift contract rejects empty slots.
 */
export function checkBounds(total: bigint, n: number, min: bigint, max: bigint): BoundsError | null {
  if (!Number.isInteger(n) || n < 1 || n > MAX_RECIPIENTS) {
    return { code: "people", message: `Choose between 1 and ${MAX_RECIPIENTS} people.` };
  }
  if (total <= 0n) return { code: "total", message: "Enter a total amount." };
  if (min <= 0n) return { code: "minZero", message: "Minimum must be more than 0, so everyone gets something." };
  if (max < min) return { code: "maxBelowMin", message: "Maximum can't be lower than the minimum." };
  const count = BigInt(n);
  if (min * count > total) {
    const limit = total / count;
    return {
      code: "minTooHigh",
      limit,
      message: `Minimum is too high for this total. With ${n} people it can be at most ${fmt(limit)} USDC.`,
    };
  }
  if (max * count < total) {
    const limit = (total + count - 1n) / count;
    return {
      code: "maxTooLow",
      limit,
      message: `Maximum is too low for this total. With ${n} people it must be at least ${fmt(limit)} USDC.`,
    };
  }
  return null;
}

const floorTo = (x: bigint, step: bigint) => (x / step) * step;
const ceilTo = (x: bigint, step: bigint) => ((x + step - 1n) / step) * step;

/**
 * Default bounds: 1–20 USDC when that works for this total and group size, otherwise a range
 * around the average share (≈⅕× to 2× the average, in cents where possible). Always feasible.
 */
export function suggestBounds(total: bigint, n: number): { min: bigint; max: bigint } {
  const count = BigInt(Math.max(1, n));
  // A max nobody can reach (e.g. 20 when the whole gift is 5) only confuses, so cap it at what one person can get.
  const cap = (min: bigint, max: bigint) => {
    const reach = reachableMax(total, n, min);
    return reach !== null && max > reach ? reach : max;
  };
  const preferred = { min: 1_000_000n, max: cap(1_000_000n, 20_000_000n) };
  if (!checkBounds(total, n, preferred.min, preferred.max)) return preferred;
  const avg = total / count;
  const step = avg >= CENT ? CENT : 1n;
  let min = floorTo(avg / 5n, step);
  if (min < 1n) min = 1n;
  let max = ceilTo((total * 2n + count - 1n) / count, step); // ≈ 2 × average, rounded up
  if (max > total) max = total;
  if (max * count < total) max = ceilTo((total + count - 1n) / count, step);
  if (min * count > total) min = 1n;
  return { min, max: cap(min, max) };
}

/**
 * The most any one person can actually receive: everyone else gets the minimum. Null when the
 * minimum itself doesn't fit. A max above this is allowed (it just never binds), but is worth flagging.
 */
export function reachableMax(total: bigint, n: number, min: bigint): bigint | null {
  const count = BigInt(Math.max(1, n));
  const reach = total - (count - 1n) * min;
  return reach >= min ? reach : null;
}

/**
 * Deterministic byte stream from a secret 32-byte seed: keccak256(seed ‖ counter) blocks.
 * Seed it from crypto.getRandomValues; the stream is then unpredictable, yet re-deriving the
 * same seed reproduces the same split (so the preview shown is exactly what gets committed).
 */
export function seededRandom(seed: Uint8Array): RandomBytes {
  let counter = 0n;
  let pool: Uint8Array = new Uint8Array(0);
  return (buf) => {
    let filled = 0;
    while (filled < buf.length) {
      if (pool.length === 0) {
        const block = new Uint8Array(seed.length + 8);
        block.set(seed);
        new DataView(block.buffer).setBigUint64(seed.length, counter++);
        pool = keccak256(block, "bytes");
      }
      const take = Math.min(pool.length, buf.length - filled);
      buf.set(pool.subarray(0, take), filled);
      pool = pool.subarray(take);
      filled += take;
    }
    return buf;
  };
}

export function newSeed(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Random split where every share is within [min, max] and the shares add up to exactly `total`.
 * All math is in integer base units (USDC: 6 decimals). Works in whole cents when total, min and
 * max are all cent amounts, so previews read like 8.42 rather than 8.421337.
 *
 * Method: everyone starts at `min`; the rest is handed out one person at a time. Each draw is
 * uniform in a window around twice the remaining average ("double average"), clipped so that
 * (a) nobody exceeds `max` and (b) what's left can still fit in the remaining people. The array
 * is then Fisher–Yates shuffled, so no position (e.g. the last) systematically gets the leftover.
 */
export function boundedRandomAllocations(
  total: bigint,
  n: number,
  min: bigint,
  max: bigint,
  rng: RandomBytes = cryptoRandom,
): bigint[] {
  const err = checkBounds(total, n, min, max);
  if (err) throw new Error(err.message);

  const unit = total % CENT === 0n && min % CENT === 0n && max % CENT === 0n ? CENT : 1n;
  const count = BigInt(n);
  const lowU = min / unit;
  const capU = max / unit - lowU; // extra room per person
  let rest = total / unit - lowU * count; // extra to hand out

  const units: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const left = BigInt(n - i);
    const after = left - 1n;
    const lo = rest - after * capU > 0n ? rest - after * capU : 0n; // must take at least this
    const hi = rest < capU ? rest : capU;
    let extra: bigint;
    if (after === 0n) {
      extra = rest;
    } else {
      let upper = (2n * rest) / left;
      if (upper > hi) upper = hi;
      if (upper < lo) upper = lo;
      extra = lo + randomBigInt(upper - lo, rng);
    }
    units.push(lowU + extra);
    rest -= extra;
  }

  // Fisher–Yates with the same random source.
  for (let i = units.length - 1; i > 0; i--) {
    const j = Number(randomBigInt(BigInt(i), rng));
    [units[i], units[j]] = [units[j], units[i]];
  }

  const result = units.map((u) => u * unit);
  validateBoundedAllocations(result, total, n, min, max);
  return result;
}

/** The invariant checked before any gift transaction: exact sum, right count, all within bounds. */
export function validateBoundedAllocations(allocations: bigint[], total: bigint, n: number, min: bigint, max: bigint) {
  validateAllocations(allocations, total, n);
  allocations.forEach((a, i) => {
    if (a < min || a > max) throw new Error(`allocation ${i} (${a}) is outside ${min}–${max}`);
  });
}
