# Arc Mainnet — deliberate, separate deployment

Mainnet is **never** deployed automatically. `Deploy.s.sol` refuses chain 5042 unless
`ALLOW_MAINNET=true` is set explicitly, and refuses any RPC whose chain ID doesn't match
`EXPECTED_CHAIN_ID`.

## Checklist (do every step, in order)

1. **Testnet sign-off**: full E2E pass on Arc Testnet recorded in `docs/TESTNET.md`.
2. **Re-run everything** from a clean checkout:
   `npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run build`
3. **Re-check contract source**: `git diff <testnet-deploy-commit> -- contracts/src` must be empty,
   or re-run step 1 on testnet with the new source.
4. **Re-check network values against the docs** (not memory):
   - https://docs.arc.io/arc/references/connect-to-arc (chain ID 5042, RPC, explorer)
   - https://docs.arc.io/arc/references/contract-addresses (USDC)
5. `cp contracts/.env.mainnet.example contracts/.env.mainnet`, fill it, then run
   `npm run preflight:mainnet`. It checks chain ID, that USDC matches the docs, decimals = 6,
   symbol, and that **no testnet value remains** in the file.
6. Review security notes in `docs/SECURITY.md`; get an external audit for material value.
7. Deploy (from `contracts/`, with a hardware wallet or keystore — never a raw key in shell history):
   ```bash
   set -a; source .env.mainnet; set +a
   ALLOW_MAINNET=true forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --account <keystore> --broadcast
   forge verify-contract <ADDRESS> src/ArcGift.sol:ArcGift --chain-id 5042 \
     --verifier blockscout --verifier-url "$VERIFIER_URL" \
     --constructor-args $(cast abi-encode "constructor(address)" "$USDC_ADDRESS")
   ```
8. Put the address in `CONTRACT_ADDRESS` and re-run `npm run preflight:mainnet` (now also checks
   code exists and `ArcGift.usdc()` matches).
9. Frontend: set `web/src/config/networks.json` → `mainnet.giftContractAddress` to the **new
   ArcGift mainnet address** (never the testnet one — startup validation refuses that — and never
   an ArcClaim address), then run `npm run preflight:app:mainnet` and `npm --prefix web test`.
10. Smoke test with a small gift (e.g. 1 USDC, 2 recipients) before announcing.
