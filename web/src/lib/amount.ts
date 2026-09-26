import { formatUnits, parseUnits } from "viem";

/** USDC ERC-20 interface decimals on every Arc network. Native (gas) interface is 18 — never mixed here. */
export const USDC_DECIMALS = 6;

const AMOUNT_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Parse a user-typed USDC amount into 6-decimal base units. Never uses floating point. */
export function parseUsdc(input: string): bigint | null {
  const value = input.trim().replace(/,/g, "");
  if (!AMOUNT_RE.test(value)) return null;
  const [, fraction = ""] = value.split(".");
  if (fraction.length > USDC_DECIMALS) return null; // reject rather than silently round
  return parseUnits(value, USDC_DECIMALS);
}

/** Format base units for display. Trims trailing zeros but keeps at least `minDecimals`. */
export function formatUsdc(units: bigint, minDecimals = 2): string {
  const raw = formatUnits(units, USDC_DECIMALS);
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(minDecimals, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}
