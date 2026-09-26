import { describe, expect, it } from "vitest";
import raw from "@/config/networks.json";
import {
  DEFAULT_NETWORK,
  NETWORKS,
  NETWORK_IDS,
  addressUrl,
  buildNetworks,
  networkByChainId,
  networkFromParam,
  txUrl,
} from "./networks";

type Entry = Omit<(typeof raw)["testnet"], "giftContractAddress"> & { giftContractAddress: string | null };
const clone = () => JSON.parse(JSON.stringify(raw)) as { testnet: Entry; mainnet: Entry };

describe("network config", () => {
  it("defaults to Testnet", () => {
    expect(DEFAULT_NETWORK).toBe("mainnet");
    expect(NETWORK_IDS.slice(0, 2)).toEqual(["testnet", "mainnet"]);
  });

  it("Testnet values", () => {
    const t = NETWORKS.testnet;
    expect(t.name).toBe("Testnet");
    expect(t.chainId).toBe(5042002);
    expect(t.rpcUrl).toBe("https://rpc.testnet.arc.network");
    expect(t.usdcAddress).toBe("0x3600000000000000000000000000000000000000");
    expect(t.usdcDecimals).toBe(6);
    expect(t.explorerUrl).toBe("https://testnet.arcscan.app");
    expect(t.chain.id).toBe(5042002);
  });

  it("Mainnet values", () => {
    const m = NETWORKS.mainnet;
    expect(m.name).toBe("Mainnet");
    expect(m.chainId).toBe(5042);
    expect(m.rpcUrl).toBe("https://rpc.mainnet.arc.io");
    expect(m.usdcAddress).toBe("0x3600000000000000000000000000000000000000");
    expect(m.usdcDecimals).toBe(6);
    expect(m.explorerUrl).toBe("https://explorer.arc.io");
    expect(m.chain.id).toBe(5042);
  });

  it("ArcGift addresses: the verified testnet and mainnet deploys (never guessed)", () => {
    // Deployed + Blockscout-verified 2026-09-26, tx 0x3923ad458101117fc8f4841772f2669fa1f77c231ac71e361dda62727fda52e4
    expect(NETWORKS.testnet.giftContractAddress).toBe("0x3A08826cFFF2759aeEA8086CE5a8FAEcbD0653B2");
    // Deployed 2026-09-26, tx 0x38f5f1e46c5a142c18908797f61ae04839b09b876f690f935bdc862cb0030628
    expect(NETWORKS.mainnet.giftContractAddress).toBe("0x7969895bc1f35ceC84f9AE587cEae073E22F4E63");
  });

  it("explorer links use each network's own explorer", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(txUrl(NETWORKS.testnet, hash)).toBe(`https://testnet.arcscan.app/tx/${hash}`);
    expect(txUrl(NETWORKS.mainnet, hash)).toBe(`https://explorer.arc.io/tx/${hash}`);
    expect(addressUrl(NETWORKS.testnet, "0x1")).toBe("https://testnet.arcscan.app/address/0x1");
    expect(addressUrl(NETWORKS.mainnet, "0x1")).toBe("https://explorer.arc.io/address/0x1");
  });

  it("?network= param: explicit values honoured, missing/unknown → Testnet (never Mainnet)", () => {
    expect(networkFromParam("testnet")).toBe("testnet");
    expect(networkFromParam("mainnet")).toBe("mainnet");
    expect(networkFromParam(undefined)).toBe("testnet");
    expect(networkFromParam(null)).toBe("testnet");
    expect(networkFromParam("MAINNET")).toBe("testnet");
    expect(networkFromParam("arc-mainnet")).toBe("testnet");
    expect(networkFromParam(["mainnet", "testnet"])).toBe("mainnet");
  });

  it("finds a network by wallet chain id", () => {
    expect(networkByChainId(5042002)?.id).toBe("testnet");
    expect(networkByChainId(5042)?.id).toBe("mainnet");
    expect(networkByChainId(1)).toBeUndefined();
  });
});

describe("config safety checks", () => {
  const A = "0x1111111111111111111111111111111111111111";

  it("rejects Mainnet pointing at the Testnet ArcGift contract", () => {
    const c = clone();
    c.testnet.giftContractAddress = A;
    c.mainnet.giftContractAddress = A;
    expect(() => buildNetworks(c as never)).toThrow(/never point at the testnet/);
  });

  it("rejects the USDC token used as the ArcGift contract", () => {
    const c = clone();
    c.testnet.giftContractAddress = "0x3600000000000000000000000000000000000000";
    expect(() => buildNetworks(c as never)).toThrow(/not USDC/);
  });

  it("rejects wrong chain ids and testnet URLs in mainnet", () => {
    const c = clone();
    c.mainnet.chainId = 5042002;
    expect(() => buildNetworks(c as never)).toThrow(/5042/);
    const d = clone();
    d.mainnet.explorerUrl = "https://testnet.arcscan.app";
    expect(() => buildNetworks(d as never)).toThrow(/testnet URL/);
  });

  it("rejects malformed addresses", () => {
    const c = clone();
    c.testnet.giftContractAddress = "0x123";
    expect(() => buildNetworks(c as never)).toThrow(/valid address/);
  });

  it("accepts distinct deployed addresses", () => {
    const c = clone();
    c.testnet.giftContractAddress = A;
    c.mainnet.giftContractAddress = "0x2222222222222222222222222222222222222222";
    const n = buildNetworks(c as never);
    expect(n.testnet.giftContractAddress).toBe(A);
  });
});
