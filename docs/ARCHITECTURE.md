# Arc Gift — Architecture

> Arc Gift makes sending USDC feel like giving someone a gift.

## Verified network facts (Arc docs, checked 2026-09-25 and against live RPCs)

| | Arc Testnet | Arc Mainnet | Source |
|---|---|---|---|
| Chain ID | 5042002 | 5042 | docs.arc.io/arc/references/connect-to-arc + `eth_chainId` |
| RPC | https://rpc.testnet.arc.io, https://rpc.testnet.arc.network (both verified live) | https://rpc.mainnet.arc.io | same |
| Explorer (Blockscout) | https://explorer.testnet.arc.io (= testnet.arcscan.app) | https://explorer.arc.io | same |
| USDC (ERC-20 interface) | `0x3600…0000`, 6 decimals | same | docs.arc.io/arc/references/contract-addresses + `decimals()` |
| Native gas | USDC, 18 decimals (same balance) | same | docs.arc.io/arc/references/evm-differences |
| PREVRANDAO | always `0` | always `0` | evm-differences + observed `mixHash = 0x0` |
| `eth_getLogs` range | ~10k blocks max | — | observed (`-32012 requested range too large`) |
| Wallet stack | viem + wagmi (built-in `arcTestnet` / `arc` chains) | | docs.arc.io/integrate/connect-to-arc |

Consequences that shaped the design:

1. **No on-chain randomness** → random splits are drawn off-chain with a CSPRNG and committed.
2. **ERC-20 USDC is 6 decimals, native is 18** → the contract uses only the ERC-20 interface and
   never `msg.value`. The UI parses amounts as strings → bigint with 6 decimals (no floats).
3. **Narrow log ranges** → claim history is stored on-chain with its block number; the UI fetches
   each tx hash with a single-block log query instead of scanning.
4. **Gas is paid in USDC** → create leaves ~0.05 USDC headroom; the claim page warns when the
   recipient has no USDC for fees; `claim()` accepts relayed submissions so a gas sponsor can be
   added later without a contract change.

## Networks

ArcGift is network-aware at runtime. One file, `web/src/config/networks.json`, holds every
network-dependent value; `web/src/lib/networks.ts` validates it at startup and is the only module
components use.

| | Testnet | Mainnet |
|---|---|---|
| chainId | 5042002 | 5042 |
| rpcUrl | https://rpc.testnet.arc.network | https://rpc.mainnet.arc.io |
| explorerUrl | https://testnet.arcscan.app | https://explorer.arc.io |
| usdcAddress (USDC token) | 0x3600…0000, 6 decimals | 0x3600…0000, 6 decimals |
| giftContractAddress (ArcGift) | `null` until deployed | `null` until deployed |

Startup checks (throwing on violation): chain IDs are exactly 5042002 / 5042; Mainnet never
shares the Testnet ArcGift address; the ArcGift address is never the USDC token; no "testnet"
URL in the Mainnet entry; every address is well-formed. ArcClaim addresses must never be added.

- **Selected network**: `NetworkProvider` (`lib/network-context.tsx`), default Testnet,
  persisted as `arcgift:network`. `NetworkBoundary` remounts every page when it changes, so
  form, claim and transaction state can't cross networks.
- **Reads**: every wagmi read passes the network's `chainId` (its own transport and cache key);
  custom queries include the network id in their keys. The navbar balance is keyed by chain, so a
  switch shows "…" until the new network answers and never the old value.
- **Local storage**: saved gift links are namespaced `arcgift:v2:<network>:<chainId>:<contract>`.
- **Wallet**: navbar shows *Switch to Arc Testnet/Mainnet* when the wallet's chain differs; flows
  show a *Wrong network* panel. Switching uses `wallet_switchEthereumChain` via wagmi, only on a
  user click.
- **Before every transaction** (approve, create, claim, reclaim) `assertWalletOn(network)` asks
  the wallet for its live `eth_chainId` and aborts on mismatch; wagmi's `writeContract({chainId})`
  enforces the same check again.
- **Gift links** are `/gift/{id}?network={testnet|mainnet}#k={key}`; QR codes and share targets
  encode the full URL. Gift pages take their network from the URL (missing or unknown means
  Testnet, never Mainnet) and make it the selected network. Switching networks on a gift page
  rewrites `?network=` and keeps the key.
- **Activity** (`/activity`) is built per network from on-chain indexes (`getGiftsBySender`,
  `getGiftsClaimedBy`, `getClaims`) plus single-block log lookups; explorer links come from
  the selected network's `explorerUrl`.
- **Local dev network**: `NEXT_PUBLIC_ENABLE_LOCAL_NETWORK=true` adds an anvil "Local" entry
  (used by E2E). It's absent from production builds.

## Repository layout

```
contracts/               Foundry project
  src/ArcGift.sol        the escrow (no owner, no upgrade, no pause)
  test/ArcGift.t.sol     53 tests incl. fuzz + reentrancy
  script/Deploy.s.sol    env-driven deploy with chain/USDC guards
  script/DeployLocal.s.sol  anvil-only (MockUSDC) for E2E
web/                     Next.js 16 app (App Router), wagmi 3, viem 2, Tailwind 4
  src/lib/               allocation, amount, claimKey, message, config, giftStore, useGift
  src/components/        GiftBox, GiftForm, ClaimView, ManageView, SharePanel, …
  src/app/               /, /create, /create/group, /gift/[id], /gift/[id]/success,
                         /gift/[id]/manage, /dashboard
  e2e/                   Playwright E2E on anvil with an injected EIP-1193 test wallet
  scripts/preflight.mjs  read-only network/config checker (testnet + mainnet)
scripts/sync-abi.mjs     copies the compiled ABI into web/src/lib/abi.ts
docs/                    this file, SECURITY.md, MAINNET.md, DEMO.md
```

## How a gift works

```
Sender browser                               ArcGift contract                   Recipient browser
──────────────                               ────────────────                   ─────────────────
1. linkKey = random secp256k1 key
   claimSigner = address(linkKey)
2. allocations = CSPRNG split (Random)
   or none (Fixed: computed on-chain)
3. message = AES-GCM(linkKey, text)
4. approve(USDC, total)  ─────────────────▶
5. createGift({mode,total,n,allocations,     checks n, sum, >0, expiry bounds
   expiresAt, claimSigner, message}) ─────▶  stores gift, pulls USDC, verifies
                                             exact amount received
6. link = /gift/{id}#k={linkKey}  ─── shared via copy / QR / Telegram / X ───▶ 7. read #k (never sent
                                                                                  to any server)
                                                                               8. decrypt message
                                                                               9. sig = sign(linkKey,
                                                                                  Claim(id, wallet))
                                             10. claim(id, wallet, sig) ◀──────
                                                 verify sig == claimSigner
                                                 slot = claimedCount++
                                                 pay allocation[slot]
11. after expiry: reclaim(id) ────────────▶  sender only, once, unclaimed only
```

### Why a link key instead of "anyone can claim"
Gift IDs and creation events are public. Without a secret, a bot could drain every gift the moment
it's created. The link key is a bearer secret: holding the link is what grants a claim. Because the
signature commits to the **recipient address**, a copied or front-run transaction can only ever pay
the address that was signed for.

### Random distribution: why pre-committed allocations
- Arc exposes no on-chain randomness (PREVRANDAO is 0) and the docs point to oracles/VRFs. No
  Arc-supported VRF was found in the official docs, and adding an oracle dependency (plus its
  fees and latency) is unnecessary here.
- **Who could manipulate randomness, and would it matter?** The sender is spending their own
  money and could choose any split anyway, so they need no protection from themselves. Recipients
  are the party to protect: they must not be able to influence their amount.
- So the split is drawn in the sender's browser with `crypto.getRandomValues` (rejection sampling,
  no modulo bias; `Math.random` is never used — a unit test enforces it), then committed **in the
  same transaction as the deposit**. There is no function that can change allocations afterwards.
- The contract independently enforces: `allocations.length == recipients`, every slot `> 0`, and
  `sum(allocations) == totalAmount == USDC actually received`.
- Recipients get slots strictly in claim order (`slot = claimedCount`); a claimer cannot pick a
  slot. See SECURITY.md for the residual "wait for a bigger slot" consideration.
- Algorithm: "broken stick" — n−1 uniform cut points over the distributable amount, sorted, gaps
  become shares; each slot gets a floor of 10% of the average so nobody opens a 0.01 gift out of
  100; amounts are rounded to cents when possible and sub-cent dust is assigned to one random slot.

### Fixed distribution
Computed on-chain: `base = total / n`, and the first `total % n` slots get `base + 1` base unit.
E.g. 100 USDC / 3 → 33.333334, 33.333333, 33.333333. Sum is always exact; no dust is left.

### Gift states
`status()` on-chain: `Active` → `SoldOut` (all slots claimed) | `Expired` (time ≥ expiresAt with
slots left) → `Reclaimed` (sender took back the unclaimed part). Claims are valid while
`block.timestamp < expiresAt`; reclaim is valid while `block.timestamp >= expiresAt` — no overlap,
no gap. There is deliberately **no early cancel**: a shared link stays good until it expires.

### Gift message
Optional, ≤200 characters. Encrypted client-side with AES-256-GCM using
`SHA-256("arcgift:message:v1" ‖ linkKey)`, fresh 12-byte IV, stored on-chain as opaque bytes
(≤1024). Only link holders can read it; the chain only sees ciphertext.

### Frontend data flow
- Reads use `useReadContracts` with polling (5s on gift pages, 10s on the dashboard) for live
  progress; no backend or indexer.
- The sender's link keys are kept in `localStorage`, saved **before** the create tx is sent (keyed
  by signer address) so a closed tab can't lose a funded link. Losing the device means the link
  can't be re-shown, but funds are still reclaimable after expiry.
- Wallets: wagmi `injected` connector with EIP-6963 discovery (MetaMask, Rabby, OKX, Coinbase
  extension, and mobile in-app browsers). Wrong-network detection + `wallet_switchEthereumChain`
  (wagmi adds the chain if the wallet doesn't know it). No silent switching.
