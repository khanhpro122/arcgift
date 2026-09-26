# Arc Gift — Arc Microgrants demo (≈3 minutes)

**One line:** Arc Gift makes sending USDC feel like giving someone a gift.

**Why Arc:** USDC is the native currency, so a gift is USDC end to end, gas included. Fees are
tiny and finality is instant, so opening a gift feels immediate.

## Setup (before the demo)
- Sender wallet on Arc Testnet with ~120 USDC (faucet.circle.com).
- 3 recipient wallets with ~0.1 USDC each for gas (different browsers/profiles, or phones).

## Script
1. **Home**: "Send USDC like a present." Tap **Create a group gift**.
2. **Create**: 100 USDC, 20 people, **Random**, message "Thanks for being part of the
   community ❤️", 7 days. Tap **Preview amounts** to show the surprise split (drawn with a
   CSPRNG, and every amount is locked on-chain the moment the gift is funded).
3. **Create group gift**: approve, then confirm. The **Gift created** screen shows the link, QR,
   Copy, Download QR, Share, Telegram, and X.
4. **Recipient 1 scans the QR** on a phone: gift box, the message, "0 of 20 opened". Connect,
   then **Open gift**. The lid lifts and **7.82 USDC** appears. **Claim gift** leads to
   "Gift claimed! 🎉" with a link to the transaction.
5. **Recipients 2 and 3** open the same link and get **different amounts**. Trying again from
   the same wallet shows "You already opened this gift".
6. **Sender → My gifts → the gift**: live progress (3 of 20 opened, USDC claimed / remaining),
   claim list with tx links, the decrypted message, and the link and QR to share again.
7. **Expiry & reclaim**: when a gift expires, the page shows "Gift expired, Claimed X,
   Unclaimed Y, **Reclaim Y USDC**". Only the unclaimed part comes back, and only once.
   (For a live demo, pre-create a gift with a short custom expiry.)

## Talking points
- Security is on-chain: exact sums, one claim per wallet, slot order, expiry, and sender-only
  reclaim are all enforced by the contract (53 tests, plus a full browser E2E suite).
- The link key lives in the URL fragment, which never reaches a server, and the claim signature
  pins the recipient, so front-runners can't steal gifts.
- Messages are encrypted with the link key, so the chain stores only ciphertext.
