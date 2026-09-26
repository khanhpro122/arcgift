# 🎁 Arc Gift

**Arc Gift makes sending USDC feel like giving someone a gift.**

Wrap USDC, share one link or QR code, and let people open it. It works for one person or for a
whole group, with an even split or a surprise random split. Every rule (exact sums, one claim per
wallet, expiry, sender-only reclaim) is enforced on-chain on [Arc](https://arc.io).

- **Single & group gifts**: one link, up to 200 recipients, one claim per wallet
- **Fixed or random split**: random amounts are drawn with a CSPRNG and locked on-chain in the
  funding transaction; the contract verifies they sum exactly to the deposit
- **Gift message**: optional, encrypted with the link key, so only link holders can read it
- **Link + QR + Share**: copy, download QR, native share, Telegram, X
- **Live progress**: "13 of 20 opened · 65 USDC claimed · 35 USDC remaining"
- **Expiry & reclaim**: after expiry the sender takes back only what was never claimed, once
- **Mobile-first** UI that feels like opening a present, not a DeFi dashboard

Docs: [Architecture](docs/ARCHITECTURE.md) · [Security review](docs/SECURITY.md) ·
[Mainnet runbook](docs/MAINNET.md) · [Demo script](docs/DEMO.md)

## Stack

| Layer | Choice |
|---|---|
| Chain | Arc Mainnet (5042) `0x7969895bc1f35ceC84f9AE587cEae073E22F4E63` · Arc Testnet (5042002) `0x3A08826cFFF2759aeEA8086CE5a8FAEcbD0653B2` |
| Contract | Solidity 0.8.30, OpenZeppelin 5.6.1, Foundry |
| Frontend | Next.js 16 (App Router), React 19, wagmi 3, viem 2, Tailwind 4 |
| Tests | Foundry (unit, fuzz, reentrancy), Vitest (libs), Playwright (browser E2E) |

## Quick start

```bash
cd web && npm install && cd ..
npm --prefix web run dev
```

To build or test the contracts, fetch the Solidity libraries first (`contracts/lib/` isn't committed;
versions are pinned in `contracts/foundry.lock`):

```bash
cd contracts
forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.6.1
forge test
```

No env is needed for Testnet or Mainnet. All network values (RPC, USDC, explorer, and each
network's own ArcGift contract address) live in one file, `web/src/config/networks.json`, and users
pick the network from the navbar (default Mainnet, remembered as `arcgift:network`).
A contract address stays `null` until ArcGift is actually deployed there, and the UI then says
"ArcGift contract is not deployed on this network yet."

## Commands (from the repo root)

| Command | What it does |
|---|---|
| `npm test` | Contract tests (`forge test`) + frontend unit tests (Vitest) |
| `npm run test:e2e` | Browser E2E on a fresh local chain (anvil + real ArcGift) |
| `npm run lint` | `forge fmt --check`, `forge lint`, ESLint |
| `npm run typecheck` | Next typegen + `tsc --noEmit` |
| `npm run build` | `forge build`, ABI sync, `next build` |
| `npm run preflight:testnet` / `:mainnet` | Read-only check of a contracts deploy env file against the live chain |
| `npm run preflight:app:testnet` / `:mainnet` | Read-only check of that network's entry in `networks.json` |

## Testnet deployment

```bash
cd contracts
cp .env.testnet.example .env.testnet        # fill PRIVATE_KEY (testnet only)
npm --prefix ../web run preflight -- ../contracts/.env.testnet
set -a; source .env.testnet; set +a
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
forge verify-contract <ADDRESS> src/ArcGift.sol:ArcGift --chain-id 5042002 \
  --verifier blockscout --verifier-url "$VERIFIER_URL" \
  --constructor-args $(cast abi-encode "constructor(address)" "$USDC_ADDRESS")
```

Then put the address in `web/src/config/networks.json` → `testnet.giftContractAddress` and run:

```bash
npm run preflight:app:testnet                          # chain id, USDC, code at address, ArcGift.usdc()
npm --prefix web run test:testnet                      # on-chain run, incl. real expiry + reclaim
E2E_TARGET=testnet npm --prefix web run test:e2e       # browser E2E on Arc Testnet
```

Get testnet USDC at https://faucet.circle.com (Arc Testnet). Gas on Arc is paid in USDC.

## Network values

Centralised in `web/src/config/networks.json` and checked against the live RPCs (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#networks)). Components never hard-code an address.
ArcGift has its **own** contracts; ArcClaim addresses must never appear in this config.
