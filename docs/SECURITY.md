# Arc Gift — Security review

Scope: `contracts/src/ArcGift.sol` (Solidity 0.8.30, OpenZeppelin 5.6.1) and the security-relevant
frontend code (`web/src/lib/*`). Reviewed 2026-09-25. Internal review only — **not a third-party
audit**; get one before holding significant mainnet value.

Trust model: no owner, no admin, no upgrade proxy, no pause. USDC held for a gift can move only
(a) to a recipient authorised by the gift's link key, or (b) back to the gift's sender after expiry.

| # | Threat | Mitigation | Test(s) |
|---|---|---|---|
| 1 | **Double claim** | `hasClaimed[gift][recipient]` set before transfer; slot counter increments atomically | `test_Fixed_DoubleClaimReverts`, `test_Random_DoubleClaimReverts`, `test_Group_OneClaimPerWallet`, E2E revisit |
| 2 | **Reentrancy** | `nonReentrant` on `createGift/claim/reclaim`; checks-effects-interactions; events before transfers | `ArcGiftReentrancyTest` (malicious token re-enters claim and reclaim) |
| 3 | **Unauthorized claim** | EIP-712 `Claim(giftId, recipient)` must be signed by the gift's `claimSigner` (link key) | `test_Sec_UnauthorizedClaim_WrongKey`, E2E wrong-key link |
| 4 | **Unauthorized reclaim** | `msg.sender == sender` only; the link key grants nothing here | `test_Sec_UnauthorizedReclaim` |
| 5 | **Replay** | Domain binds chainId + contract; message binds giftId + recipient; `hasClaimed` stops same-recipient replays; OZ ECDSA rejects high-s malleable signatures | `…AcrossGifts`, `…AcrossDeployments`, `…AcrossChains`, `test_Sec_MalleableSignatureRejected` |
| 6 | **Front-running** | Signature pins the payout address: a copied tx either reverts or pays the original recipient | `test_Sec_FrontRunCannotRedirectFunds` |
| 7 | **Allocation manipulation** | Allocations committed in the deposit tx; no setter exists; contract checks length, each > 0, exact sum; claimer can't choose a slot | `test_Random_*Mismatch*`, `…ZeroAllocation…`, `…LengthMismatch…`, `testFuzz_RandomConservation` |
| 8 | **Randomness manipulation** | Off-chain CSPRNG (`crypto.getRandomValues`, rejection sampling). No `Math.random`, no block values (PREVRANDAO is 0 on Arc anyway) | `allocation.test.ts` ("uses the injected CSPRNG, not Math.random") |
| 9 | **Expiry manipulation** | `expiresAt` fixed at creation within [now+10min, now+365d]; immutable. Arc timestamps are non-decreasing with 1s granularity — irrelevant at this scale. Claim `<` expiry, reclaim `>=` expiry | `test_Sec_ExpiryBounds`, `test_Edge_ClaimNearExpiry`, `…AtAndAfterExpiry`, `…ReclaimNearExpiry` |
| 10 | **Overflow / precision** | 0.8 checked math; totals `uint128`, sums in `uint256`; every narrowing cast is bounded and annotated; Fixed split gives remainder to first slots so sum is exact | `testFuzz_FixedSumIsExact`, `test_Edge_OddDivisionAndRounding`, `test_Edge_LargeAmount` |
| 11 | **USDC decimals** | Contract uses only the 6-decimal ERC-20 interface; never `msg.value`. UI parses strings → bigint (rejects >6 decimals); native 18-dec balance only used for the gas hint | `allocation.test.ts` parsing tests; deploy script asserts `decimals()==6` |
| 12 | **Approval / transferFrom** | UI approves the exact amount (no unlimited allowance). `SafeERC20`; balance-delta check rejects any token that delivers less | `test_Sec_FeeOnTransferDepositRejected`, `test_Sec_NoApprovalNoGift` |
| 13 | **Invalid gift ID** | `GiftNotFound` on every entry point and view | `test_Sec_InvalidGiftId`, E2E |
| 14 | **Sold out** | `SoldOut` once `claimedCount == recipients` | `test_Fixed_SoldOut`, `test_Group_MultipleWalletsProgressAndSoldOut`, E2E |
| 15 | **Reclaim twice / claim after reclaim** | `reclaimed` flag; `GiftAlreadyReclaimed` | `test_Edge_ReclaimTwiceReverts`, `test_Edge_ClaimAfterReclaimReverts` |
| 16 | **Race / simultaneous claims** | Each claim is atomic; slots assigned in tx order; the loser of a race for the last slot gets `SoldOut` (UI simulates first, so usually before signing). Success page shows the amount from the actual `GiftClaimed` event | `test_Group_SimultaneousClaimsSameBlockGetSequentialSlots` |
| 17 | **Unbounded loops / DoS** | `MAX_RECIPIENTS = 200` bounds all loops; message ≤ 1024 bytes | `test_Sec_CreateValidation`, `test_Message_StoredAndBounded` |
| 18 | **Message XSS** | Message is opaque ciphertext on-chain; rendered as React text (escaped) | — |

## Accepted risks / limitations

- **Links are bearer secrets.** Anyone holding a link can claim a slot. Posting a group link
  publicly (e.g. on X) is effectively an open airdrop — the UI warns about this.
- **Sybil claims.** One person with many wallets can claim many slots of a group gift. Inherent to
  link-based gifts; an allowlist (Merkle root) would be the upgrade path.
- **Slot visibility.** Allocations are readable on-chain, and slots are paid in order, so a link
  holder could wait for the next slot to be a large one. They can't choose or change amounts, and
  waiting risks someone else claiming first. Hiding amounts from link holders isn't possible
  without an oracle/VRF or a trusted server, and link holders are the intended recipients.
- **Link key storage.** The sender's keys live in `localStorage`. An XSS in the app could read
  them; the app loads no third-party scripts and sets `no-referrer` / `DENY` framing headers. A
  CSP with nonces is a recommended hardening step before mainnet.
- **Blocklisted addresses.** USDC enforces its blocklist on transfer. A blocklisted recipient
  can't claim (others are unaffected). If the *sender* becomes blocklisted, reclaim reverts.
- **Recipients need USDC for gas** on Arc. `claim()` already supports third-party submission, so a
  sponsor/relayer can be added without changing the contract.
- **Lost device** means the sender can't re-show the link; funds remain reclaimable after expiry.
