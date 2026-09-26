// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title ArcGift
/// @notice Escrow for USDC gifts shared through a claim link (single or group gifts).
///
/// Flow:
///  1. The sender generates an ephemeral keypair off-chain. Its private key lives only in the
///     claim link's URL fragment (never sent to a server); its address is stored as `claimSigner`.
///  2. The sender deposits USDC with either a Fixed split (computed here) or a Random split
///     (allocations drawn off-chain with a CSPRNG, committed here in the same tx as the deposit,
///     immutable afterwards, and verified to sum exactly to the deposit).
///  3. A link holder signs `Claim(giftId, recipient)` with the link key. The signature binds the
///     payout address, so a copied or front-run transaction can only ever pay that recipient.
///  4. Slots are paid in order, each exactly once; each address can claim once per gift.
///  5. After expiry, only the sender can reclaim — and only what was never claimed, once.
///
/// @dev Arc specifics (docs.arc.io/arc/references/evm-differences):
///  - PREVRANDAO is always 0, so nothing here depends on on-chain randomness.
///  - USDC's ERC-20 interface has 6 decimals. This contract only uses the ERC-20 interface and
///    never touches msg.value, so the 18-decimal native interface is never mixed in.
contract ArcGift is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    enum Mode {
        Fixed,
        Random
    }

    enum Status {
        Active,
        SoldOut,
        Expired,
        Reclaimed
    }

    struct Gift {
        // slot 0
        address sender;
        uint40 expiresAt;
        uint16 recipients;
        uint16 claimedCount;
        Mode mode;
        bool reclaimed;
        // slot 1
        address claimSigner;
        uint40 createdAt;
        // slot 2
        uint128 totalAmount;
        uint128 claimedAmount;
        // slot 3 — block numbers let clients fetch the exact tx without wide log scans
        uint64 createdBlock;
        uint64 reclaimedBlock;
    }

    struct ClaimRecord {
        address recipient;
        uint64 blockNumber;
        uint128 amount;
    }

    struct CreateParams {
        Mode mode;
        uint128 totalAmount;
        uint16 recipients;
        uint128[] allocations; // Random: one per recipient. Fixed: empty.
        uint40 expiresAt;
        address claimSigner;
        bytes message; // optional, encrypted client-side with the link key
    }

    // ---------------------------------------------------------------- constants

    uint16 public constant MAX_RECIPIENTS = 200;
    uint256 public constant MIN_DURATION = 10 minutes;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_MESSAGE_BYTES = 1024;

    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(uint256 giftId,address recipient)");

    // ---------------------------------------------------------------- storage

    IERC20 public immutable usdc;

    uint256 public nextGiftId = 1;

    mapping(uint256 giftId => Gift) private _gifts;
    mapping(uint256 giftId => uint128[]) private _allocations; // Random mode only
    mapping(uint256 giftId => bytes) private _messages;
    mapping(uint256 giftId => ClaimRecord[]) private _claims;
    mapping(uint256 giftId => mapping(address recipient => bool)) public hasClaimed;
    mapping(address sender => uint256[]) private _giftsBySender;
    mapping(address recipient => uint256[]) private _giftsClaimedBy;

    // ---------------------------------------------------------------- events

    event GiftCreated(
        uint256 indexed giftId,
        address indexed sender,
        Mode mode,
        uint256 totalAmount,
        uint256 recipients,
        uint256 expiresAt,
        address claimSigner
    );
    event GiftClaimed(uint256 indexed giftId, address indexed recipient, uint256 slot, uint256 amount);
    event GiftReclaimed(uint256 indexed giftId, address indexed sender, uint256 amount);

    // ---------------------------------------------------------------- errors

    error InvalidToken();
    error InvalidRecipients();
    error InvalidAmount();
    error InvalidAllocation(uint256 slot);
    error AllocationSumMismatch(uint256 sum, uint256 totalAmount);
    error UnexpectedAllocations();
    error InvalidExpiry();
    error InvalidClaimSigner();
    error MessageTooLong();
    error DepositMismatch(uint256 received, uint256 expected);
    error GiftNotFound();
    error GiftAlreadyReclaimed();
    error GiftExpired();
    error GiftNotExpired();
    error SoldOut();
    error AlreadyClaimed();
    error InvalidRecipient();
    error InvalidSignature();
    error NotSender();
    error NothingToReclaim();

    // ---------------------------------------------------------------- constructor

    constructor(IERC20 usdc_) EIP712("ArcGift", "1") {
        if (address(usdc_) == address(0)) revert InvalidToken();
        usdc = usdc_;
    }

    // ---------------------------------------------------------------- create

    /// @notice Create and fund a gift in one transaction. Requires USDC approval for `totalAmount`.
    /// @dev Fixed: slot i gets total/n, plus 1 base unit for the first `total % n` slots (exact sum).
    ///      Random: `allocations` are committed as-is; every slot must be > 0 and they must sum to
    ///      exactly `totalAmount`, which must equal the amount actually received.
    function createGift(CreateParams calldata p) external nonReentrant returns (uint256 giftId) {
        if (p.recipients == 0 || p.recipients > MAX_RECIPIENTS) revert InvalidRecipients();
        if (p.totalAmount < p.recipients) revert InvalidAmount(); // >= 1 base unit per slot
        if (p.expiresAt < block.timestamp + MIN_DURATION || p.expiresAt > block.timestamp + MAX_DURATION) {
            revert InvalidExpiry();
        }
        if (p.claimSigner == address(0)) revert InvalidClaimSigner();
        if (p.message.length > MAX_MESSAGE_BYTES) revert MessageTooLong();

        giftId = nextGiftId++;

        if (p.mode == Mode.Random) {
            if (p.allocations.length != p.recipients) revert InvalidRecipients();
            uint256 sum = 0;
            uint128[] storage stored = _allocations[giftId];
            for (uint256 i; i < p.allocations.length; ++i) {
                uint128 a = p.allocations[i];
                // forge-lint: disable-next-line(require-revert-in-loop)
                if (a == 0) revert InvalidAllocation(i);
                sum += a; // <= 200 * 2^128, cannot overflow uint256
                stored.push(a);
            }
            if (sum != p.totalAmount) revert AllocationSumMismatch(sum, p.totalAmount);
        } else if (p.allocations.length != 0) {
            revert UnexpectedAllocations();
        }

        _gifts[giftId] = Gift({
            sender: msg.sender,
            expiresAt: p.expiresAt,
            recipients: p.recipients,
            claimedCount: 0,
            mode: p.mode,
            reclaimed: false,
            claimSigner: p.claimSigner,
            // forge-lint: disable-next-line(unsafe-typecast) timestamps/blocks fit for millennia
            createdAt: uint40(block.timestamp),
            totalAmount: p.totalAmount,
            claimedAmount: 0,
            // forge-lint: disable-next-line(unsafe-typecast) timestamps/blocks fit for millennia
            createdBlock: uint64(block.number),
            reclaimedBlock: 0
        });
        if (p.message.length != 0) _messages[giftId] = p.message;
        _giftsBySender[msg.sender].push(giftId);
        emit GiftCreated(giftId, msg.sender, p.mode, p.totalAmount, p.recipients, p.expiresAt, p.claimSigner);

        // Pull funds and verify the exact amount arrived.
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), p.totalAmount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != p.totalAmount) revert DepositMismatch(received, p.totalAmount);
    }

    // ---------------------------------------------------------------- claim

    /// @notice Claim the next unclaimed slot of a gift for `recipient`.
    /// @param signature EIP-712 signature of Claim(giftId, recipient) by the gift's link key.
    ///        Anyone may submit it (e.g. a gas sponsor), but funds only go to the signed `recipient`.
    function claim(uint256 giftId, address recipient, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 amount)
    {
        Gift storage g = _gifts[giftId];
        if (g.sender == address(0)) revert GiftNotFound();
        if (g.reclaimed) revert GiftAlreadyReclaimed();
        if (block.timestamp >= g.expiresAt) revert GiftExpired();
        if (g.claimedCount >= g.recipients) revert SoldOut();
        if (recipient == address(0)) revert InvalidRecipient();
        if (hasClaimed[giftId][recipient]) revert AlreadyClaimed();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, giftId, recipient)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || signer != g.claimSigner) revert InvalidSignature();

        uint256 slot = g.claimedCount;
        amount = _allocationAt(giftId, g, slot);

        // effects
        hasClaimed[giftId][recipient] = true;
        _giftsClaimedBy[recipient].push(giftId);
        // forge-lint: disable-next-line(unsafe-typecast) slot < recipients <= 200
        g.claimedCount = uint16(slot + 1);
        // forge-lint: disable-next-line(unsafe-typecast) amount <= totalAmount (uint128)
        g.claimedAmount += uint128(amount);
        // forge-lint: disable-next-line(unsafe-typecast) amount <= totalAmount (uint128)
        _claims[giftId].push(ClaimRecord(recipient, uint64(block.number), uint128(amount)));
        // forge-lint: disable-next-line(reentrancy-events) only prior "call" is the ecrecover precompile
        emit GiftClaimed(giftId, recipient, slot, amount);

        // interaction
        usdc.safeTransfer(recipient, amount);
    }

    // ---------------------------------------------------------------- reclaim

    /// @notice After expiry, the sender takes back every unclaimed slot. Callable once.
    function reclaim(uint256 giftId) external nonReentrant returns (uint256 amount) {
        Gift storage g = _gifts[giftId];
        if (g.sender == address(0)) revert GiftNotFound();
        if (g.sender != msg.sender) revert NotSender();
        if (g.reclaimed) revert GiftAlreadyReclaimed();
        if (block.timestamp < g.expiresAt) revert GiftNotExpired();

        amount = uint256(g.totalAmount) - g.claimedAmount;
        if (amount == 0) revert NothingToReclaim();

        g.reclaimed = true;
        // forge-lint: disable-next-line(unsafe-typecast) timestamps/blocks fit for millennia
        g.reclaimedBlock = uint64(block.number);
        emit GiftReclaimed(giftId, msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------- allocation math

    function _allocationAt(uint256 giftId, Gift storage g, uint256 slot) private view returns (uint256) {
        if (g.mode == Mode.Random) return _allocations[giftId][slot];
        uint256 base = uint256(g.totalAmount) / g.recipients;
        uint256 remainder = uint256(g.totalAmount) % g.recipients;
        return slot < remainder ? base + 1 : base;
    }

    function _exists(uint256 giftId) private view returns (Gift storage g) {
        g = _gifts[giftId];
        if (g.sender == address(0)) revert GiftNotFound();
    }

    // ---------------------------------------------------------------- views

    function getGift(uint256 giftId) external view returns (Gift memory) {
        return _exists(giftId);
    }

    function status(uint256 giftId) public view returns (Status) {
        Gift storage g = _exists(giftId);
        if (g.reclaimed) return Status.Reclaimed;
        if (g.claimedCount >= g.recipients) return Status.SoldOut;
        if (block.timestamp >= g.expiresAt) return Status.Expired;
        return Status.Active;
    }

    /// @notice Every slot's amount, in claim order.
    function getAllocations(uint256 giftId) external view returns (uint256[] memory amounts) {
        Gift storage g = _exists(giftId);
        amounts = new uint256[](g.recipients);
        for (uint256 i; i < g.recipients; ++i) {
            amounts[i] = _allocationAt(giftId, g, i);
        }
    }

    /// @notice Amount the next successful claim would receive (0 if the gift can't be claimed).
    function nextAllocation(uint256 giftId) external view returns (uint256) {
        Gift storage g = _exists(giftId);
        if (status(giftId) != Status.Active) return 0;
        return _allocationAt(giftId, g, g.claimedCount);
    }

    /// @notice USDC still held for this gift (unclaimed and not reclaimed).
    function remaining(uint256 giftId) external view returns (uint256) {
        Gift storage g = _exists(giftId);
        if (g.reclaimed) return 0;
        return uint256(g.totalAmount) - g.claimedAmount;
    }

    function getMessage(uint256 giftId) external view returns (bytes memory) {
        _exists(giftId);
        return _messages[giftId];
    }

    function getClaims(uint256 giftId) external view returns (ClaimRecord[] memory) {
        _exists(giftId);
        return _claims[giftId];
    }

    function getGiftsBySender(address sender) external view returns (uint256[] memory) {
        return _giftsBySender[sender];
    }

    /// @notice Gifts a wallet has claimed from, in claim order (powers per-wallet activity).
    function getGiftsClaimedBy(address recipient) external view returns (uint256[] memory) {
        return _giftsClaimedBy[recipient];
    }

    /// @notice EIP-712 digest the link key must sign. Exposed for off-chain tooling/tests.
    function claimDigest(uint256 giftId, address recipient) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, giftId, recipient)));
    }
}
