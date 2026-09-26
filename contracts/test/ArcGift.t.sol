// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ArcGift} from "../src/ArcGift.sol";
import {MockUSDC, FeeToken, HookToken, IReenter} from "./mocks/Mocks.sol";

abstract contract ArcGiftBase is Test {
    uint256 constant USDC = 1e6; // 6 decimals, like Arc's ERC-20 USDC interface

    MockUSDC usdc;
    ArcGift gift;

    address sender = makeAddr("sender");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address relayer = makeAddr("relayer");

    uint256 claimKey = 0xC1A1;
    address claimSigner;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.roll(1_000);
        usdc = new MockUSDC();
        gift = new ArcGift(IERC20(address(usdc)));
        claimSigner = vm.addr(claimKey);

        usdc.mint(sender, 1_000_000_000_000 * USDC);
        vm.prank(sender);
        usdc.approve(address(gift), type(uint256).max);
    }

    function _expiry() internal view returns (uint40) {
        return uint40(block.timestamp + 1 days);
    }

    function _params(ArcGift.Mode mode, uint128 total, uint16 n, uint128[] memory allocs)
        internal
        view
        returns (ArcGift.CreateParams memory)
    {
        return ArcGift.CreateParams({
            mode: mode,
            totalAmount: total,
            recipients: n,
            allocations: allocs,
            expiresAt: _expiry(),
            claimSigner: claimSigner,
            message: ""
        });
    }

    function _fixed(uint128 total, uint16 n) internal returns (uint256 id) {
        vm.prank(sender);
        id = gift.createGift(_params(ArcGift.Mode.Fixed, total, n, new uint128[](0)));
    }

    function _random(uint128[] memory allocs) internal returns (uint256 id) {
        uint128 total;
        for (uint256 i; i < allocs.length; ++i) {
            total += allocs[i];
        }
        vm.prank(sender);
        // forge-lint: disable-next-line(unsafe-typecast)
        id = gift.createGift(_params(ArcGift.Mode.Random, total, uint16(allocs.length), allocs));
    }

    function _sig(uint256 key, uint256 id, address recipient) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gift.claimDigest(id, recipient));
        return abi.encodePacked(r, s, v);
    }

    function _claim(uint256 id, address recipient) internal returns (uint256) {
        bytes memory sig = _sig(claimKey, id, recipient);
        vm.prank(recipient);
        return gift.claim(id, recipient, sig);
    }

    function _allocs3() internal pure returns (uint128[] memory a) {
        a = new uint128[](3);
        a[0] = 7_820_000; // 7.82
        a[1] = 12_310_000; // 12.31
        a[2] = 4_520_000; // 4.52
    }

    function _status(uint256 id) internal view returns (uint8) {
        return uint8(gift.status(id));
    }
}

contract ArcGiftTest is ArcGiftBase {
    uint8 constant ACTIVE = uint8(ArcGift.Status.Active);
    uint8 constant SOLD_OUT = uint8(ArcGift.Status.SoldOut);
    uint8 constant EXPIRED = uint8(ArcGift.Status.Expired);
    uint8 constant RECLAIMED = uint8(ArcGift.Status.Reclaimed);

    // ============================================================ FIXED

    function test_Fixed_CreateAndFund() public {
        uint256 before = usdc.balanceOf(sender);
        uint256 id = _fixed(uint128(100 * USDC), 10);
        ArcGift.Gift memory g = gift.getGift(id);
        assertEq(g.sender, sender);
        assertEq(g.totalAmount, 100 * USDC);
        assertEq(g.recipients, 10);
        assertEq(uint8(g.mode), uint8(ArcGift.Mode.Fixed));
        assertEq(g.claimSigner, claimSigner);
        assertEq(g.createdBlock, block.number);
        assertEq(g.createdAt, block.timestamp);
        assertEq(before - usdc.balanceOf(sender), 100 * USDC);
        assertEq(usdc.balanceOf(address(gift)), 100 * USDC);
        assertEq(gift.getGiftsBySender(sender)[0], id);
        assertEq(_status(id), ACTIVE);

        uint256[] memory a = gift.getAllocations(id);
        for (uint256 i; i < 10; ++i) {
            assertEq(a[i], 10 * USDC);
        }
    }

    function test_Fixed_Claim() public {
        uint256 id = _fixed(uint128(100 * USDC), 10);
        assertEq(gift.nextAllocation(id), 10 * USDC);
        assertEq(_claim(id, alice), 10 * USDC);
        assertEq(usdc.balanceOf(alice), 10 * USDC);
        assertTrue(gift.hasClaimed(id, alice));
        assertEq(gift.remaining(id), 90 * USDC);
    }

    function test_GiftsClaimedByIndex() public {
        uint256 a = _fixed(uint128(10 * USDC), 2);
        uint256 b = _random(_allocs3());
        _claim(a, alice);
        _claim(b, alice);
        _claim(b, bob);
        uint256[] memory aliceGifts = gift.getGiftsClaimedBy(alice);
        assertEq(aliceGifts.length, 2);
        assertEq(aliceGifts[0], a);
        assertEq(aliceGifts[1], b);
        assertEq(gift.getGiftsClaimedBy(bob).length, 1);
        assertEq(gift.getGiftsClaimedBy(carol).length, 0);
    }

    function test_Fixed_MultipleClaims() public {
        uint256 id = _fixed(uint128(30 * USDC), 3);
        _claim(id, alice);
        _claim(id, bob);
        assertEq(usdc.balanceOf(alice), 10 * USDC);
        assertEq(usdc.balanceOf(bob), 10 * USDC);
        assertEq(gift.getGift(id).claimedCount, 2);
        assertEq(gift.getGift(id).claimedAmount, 20 * USDC);
    }

    function test_Fixed_DoubleClaimReverts() public {
        uint256 id = _fixed(uint128(100 * USDC), 10);
        _claim(id, alice);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.prank(alice);
        vm.expectRevert(ArcGift.AlreadyClaimed.selector);
        gift.claim(id, alice, sig);
    }

    function test_Fixed_SoldOut() public {
        uint256 id = _fixed(uint128(20 * USDC), 2);
        _claim(id, alice);
        _claim(id, bob);
        assertEq(_status(id), SOLD_OUT);
        bytes memory sig = _sig(claimKey, id, carol);
        vm.expectRevert(ArcGift.SoldOut.selector);
        gift.claim(id, carol, sig);
        assertEq(usdc.balanceOf(address(gift)), 0);
        assertEq(gift.nextAllocation(id), 0);
    }

    function test_Fixed_Expiry() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(_status(id), EXPIRED);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.expectRevert(ArcGift.GiftExpired.selector);
        gift.claim(id, alice, sig);
        assertEq(gift.nextAllocation(id), 0);
    }

    function test_Fixed_Reclaim() public {
        uint256 id = _fixed(uint128(100 * USDC), 10);
        _claim(id, alice);
        _claim(id, bob);
        vm.warp(gift.getGift(id).expiresAt);
        vm.roll(vm.getBlockNumber() + 5);
        uint256 before = usdc.balanceOf(sender);
        vm.expectEmit(address(gift));
        emit ArcGift.GiftReclaimed(id, sender, 80 * USDC);
        vm.prank(sender);
        assertEq(gift.reclaim(id), 80 * USDC);
        assertEq(usdc.balanceOf(sender) - before, 80 * USDC);
        assertEq(usdc.balanceOf(address(gift)), 0);
        assertTrue(gift.getGift(id).reclaimed);
        assertEq(gift.getGift(id).reclaimedBlock, vm.getBlockNumber());
        assertEq(_status(id), RECLAIMED);
        // claimed funds stay with recipients
        assertEq(usdc.balanceOf(alice) + usdc.balanceOf(bob), 20 * USDC);
    }

    // ============================================================ RANDOM

    function test_Random_Create() public {
        uint256 id = _random(_allocs3());
        ArcGift.Gift memory g = gift.getGift(id);
        assertEq(uint8(g.mode), uint8(ArcGift.Mode.Random));
        assertEq(g.recipients, 3);
        assertEq(g.totalAmount, 24_650_000);
        assertEq(usdc.balanceOf(address(gift)), 24_650_000);
    }

    function test_Random_AllocationCorrectnessAndTotal() public {
        uint256 id = _random(_allocs3());
        uint256[] memory a = gift.getAllocations(id);
        assertEq(a[0], 7_820_000);
        assertEq(a[1], 12_310_000);
        assertEq(a[2], 4_520_000);
        assertEq(a[0] + a[1] + a[2], gift.getGift(id).totalAmount);
    }

    function test_Random_SumMismatchReverts() public {
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Random, uint128(25 * USDC), 3, _allocs3());
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcGift.AllocationSumMismatch.selector, 24_650_000, 25 * USDC));
        gift.createGift(p);
    }

    function test_Random_ZeroAllocationReverts() public {
        uint128[] memory a = _allocs3();
        a[1] = 0;
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Random, 12_340_000, 3, a);
        vm.prank(sender);
        vm.expectRevert(abi.encodeWithSelector(ArcGift.InvalidAllocation.selector, 1));
        gift.createGift(p);
    }

    function test_Random_LengthMismatchReverts() public {
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Random, 24_650_000, 4, _allocs3());
        vm.prank(sender);
        vm.expectRevert(ArcGift.InvalidRecipients.selector);
        gift.createGift(p);
    }

    function test_Fixed_RejectsAllocations() public {
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, 24_650_000, 3, _allocs3());
        vm.prank(sender);
        vm.expectRevert(ArcGift.UnexpectedAllocations.selector);
        gift.createGift(p);
    }

    function test_Random_ClaimAndMultipleClaims() public {
        uint256 id = _random(_allocs3());
        assertEq(gift.nextAllocation(id), 7_820_000);
        assertEq(_claim(id, alice), 7_820_000);
        assertEq(_claim(id, bob), 12_310_000);
        assertEq(_claim(id, carol), 4_520_000);
        assertEq(usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol), 24_650_000);
        assertEq(usdc.balanceOf(address(gift)), 0);
    }

    function test_Random_DoubleClaimReverts() public {
        uint256 id = _random(_allocs3());
        _claim(id, alice);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.expectRevert(ArcGift.AlreadyClaimed.selector);
        gift.claim(id, alice, sig);
    }

    function test_Random_Expiry() public {
        uint256 id = _random(_allocs3());
        _claim(id, alice);
        vm.warp(block.timestamp + 1 days);
        bytes memory sig = _sig(claimKey, id, bob);
        vm.expectRevert(ArcGift.GiftExpired.selector);
        gift.claim(id, bob, sig);
    }

    function test_Random_Reclaim() public {
        uint256 id = _random(_allocs3());
        _claim(id, alice);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        assertEq(gift.reclaim(id), 12_310_000 + 4_520_000);
        assertEq(usdc.balanceOf(address(gift)), 0);
        assertEq(gift.remaining(id), 0);
    }

    // ============================================================ GROUP

    function test_Group_MultipleWalletsProgressAndSoldOut() public {
        uint16 n = 20;
        uint256 id = _fixed(uint128(100 * USDC), n);
        for (uint256 i; i < 13; ++i) {
            _claim(id, address(uint160(0xA000 + i)));
        }

        ArcGift.Gift memory g = gift.getGift(id);
        assertEq(g.claimedCount, 13);
        assertEq(g.recipients - g.claimedCount, 7);
        assertEq(g.claimedAmount, 65 * USDC);
        assertEq(gift.remaining(id), 35 * USDC);
        assertEq(usdc.balanceOf(address(gift)), 35 * USDC);

        ArcGift.ClaimRecord[] memory claims = gift.getClaims(id);
        assertEq(claims.length, 13);
        assertEq(claims[12].recipient, address(uint160(0xA000 + 12)));
        assertEq(claims[12].amount, 5 * USDC);
        assertEq(claims[12].blockNumber, block.number);

        for (uint256 i = 13; i < n; ++i) {
            _claim(id, address(uint160(0xA000 + i)));
        }
        assertEq(_status(id), SOLD_OUT);
        bytes memory sig = _sig(claimKey, id, carol);
        vm.expectRevert(ArcGift.SoldOut.selector);
        gift.claim(id, carol, sig);
    }

    function test_Group_OneClaimPerWallet() public {
        uint256 id = _fixed(uint128(100 * USDC), 20);
        _claim(id, alice);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.prank(alice);
        vm.expectRevert(ArcGift.AlreadyClaimed.selector);
        gift.claim(id, alice, sig);
        assertEq(gift.getGift(id).claimedCount, 1);
    }

    function test_Group_RandomRemainingExpiryReclaim() public {
        uint128[] memory a = new uint128[](5);
        a[0] = 31_000_000;
        a[1] = 9_500_000;
        a[2] = 22_250_000;
        a[3] = 17_000_000;
        a[4] = 20_250_000; // total 100 USDC
        uint256 id = _random(a);
        _claim(id, alice);
        _claim(id, bob);
        assertEq(gift.remaining(id), 100 * USDC - 40_500_000);

        vm.warp(gift.getGift(id).expiresAt);
        assertEq(_status(id), EXPIRED);
        vm.prank(sender);
        assertEq(gift.reclaim(id), 59_500_000);
        assertEq(_status(id), RECLAIMED);
    }

    function test_Group_SimultaneousClaimsSameBlockGetSequentialSlots() public {
        uint256 id = _random(_allocs3());
        // two claims mined in the same block: both succeed, each on its own slot
        uint256 a = _claim(id, alice);
        uint256 b = _claim(id, bob);
        assertEq(a, 7_820_000);
        assertEq(b, 12_310_000);
        ArcGift.ClaimRecord[] memory c = gift.getClaims(id);
        assertEq(c[0].blockNumber, c[1].blockNumber);
    }

    // ============================================================ MESSAGE

    function test_Message_StoredAndBounded() public {
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, uint128(10 * USDC), 1, new uint128[](0));
        p.message = hex"deadbeef";
        vm.prank(sender);
        uint256 id = gift.createGift(p);
        assertEq(gift.getMessage(id), hex"deadbeef");

        uint256 other = _fixed(uint128(10 * USDC), 1);
        assertEq(gift.getMessage(other).length, 0);

        p.message = new bytes(1025);
        vm.prank(sender);
        vm.expectRevert(ArcGift.MessageTooLong.selector);
        gift.createGift(p);
    }

    // ============================================================ EDGE CASES

    function test_Edge_OneRecipient() public {
        uint256 id = _fixed(uint128(5 * USDC), 1);
        assertEq(_claim(id, alice), 5 * USDC);
        bytes memory sig = _sig(claimKey, id, bob);
        vm.expectRevert(ArcGift.SoldOut.selector);
        gift.claim(id, bob, sig);
    }

    function test_Edge_OneUSDC() public {
        uint256 id = _fixed(uint128(1 * USDC), 4);
        assertEq(_claim(id, alice), 250_000);
        assertEq(_claim(id, bob), 250_000);
    }

    function test_Edge_SmallAmount() public {
        uint256 id = _fixed(3, 3); // 0.000003 USDC → 1 base unit each
        assertEq(_claim(id, alice), 1);
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, 2, 3, new uint128[](0));
        vm.prank(sender);
        vm.expectRevert(ArcGift.InvalidAmount.selector);
        gift.createGift(p);
    }

    function test_Edge_LargeAmount() public {
        uint128 total = uint128(900_000_000_000 * USDC); // 900B USDC
        uint256 id = _fixed(total, 200);
        assertEq(_claim(id, alice), total / 200);
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, type(uint128).max, 1, new uint128[](0));
        vm.prank(sender);
        vm.expectRevert(); // insufficient balance — no overflow path in contract math
        gift.createGift(p);
    }

    function test_Edge_OddDivisionAndRounding() public {
        // 100 USDC / 3 => 33.333334, 33.333333, 33.333333 — sum exact, no dust left behind
        uint256 id = _fixed(uint128(100 * USDC), 3);
        uint256[] memory a = gift.getAllocations(id);
        assertEq(a[0], 33_333_334);
        assertEq(a[1], 33_333_333);
        assertEq(a[2], 33_333_333);
        uint256 sum = _claim(id, alice) + _claim(id, bob) + _claim(id, carol);
        assertEq(sum, 100 * USDC);
        assertEq(usdc.balanceOf(address(gift)), 0);
    }

    function test_Edge_ClaimNearExpiry() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        vm.warp(gift.getGift(id).expiresAt - 1); // last valid second
        _claim(id, alice);
        assertEq(usdc.balanceOf(alice), 5 * USDC);
    }

    function test_Edge_ClaimAtAndAfterExpiry() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        uint40 exp = gift.getGift(id).expiresAt;
        bytes memory sig = _sig(claimKey, id, bob);
        vm.warp(exp); // expiry second itself: claim closed
        vm.expectRevert(ArcGift.GiftExpired.selector);
        gift.claim(id, bob, sig);
        vm.warp(exp + 30 days);
        vm.expectRevert(ArcGift.GiftExpired.selector);
        gift.claim(id, bob, sig);
    }

    function test_Edge_ReclaimNearExpiry() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        uint40 exp = gift.getGift(id).expiresAt;
        vm.warp(exp - 1);
        vm.prank(sender);
        vm.expectRevert(ArcGift.GiftNotExpired.selector);
        gift.reclaim(id);
        vm.warp(exp); // first valid second
        vm.prank(sender);
        assertEq(gift.reclaim(id), 10 * USDC);
    }

    function test_Edge_ReclaimTwiceReverts() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        vm.warp(block.timestamp + 30 days);
        vm.prank(sender);
        gift.reclaim(id);
        vm.prank(sender);
        vm.expectRevert(ArcGift.GiftAlreadyReclaimed.selector);
        gift.reclaim(id);
        assertEq(usdc.balanceOf(address(gift)), 0);
    }

    function test_Edge_ClaimAfterReclaimReverts() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        gift.reclaim(id);
        vm.expectRevert(ArcGift.GiftAlreadyReclaimed.selector);
        gift.claim(id, alice, sig);
        assertEq(gift.remaining(id), 0);
    }

    function test_Edge_ReclaimWhenFullyClaimedReverts() public {
        uint256 id = _fixed(uint128(10 * USDC), 1);
        _claim(id, alice);
        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        vm.expectRevert(ArcGift.NothingToReclaim.selector);
        gift.reclaim(id);
        assertEq(_status(id), SOLD_OUT);
    }

    // ============================================================ SECURITY

    function test_Sec_UnauthorizedReclaim() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert(ArcGift.NotSender.selector);
        gift.reclaim(id);
        vm.prank(claimSigner); // holding the link does not grant reclaim either
        vm.expectRevert(ArcGift.NotSender.selector);
        gift.reclaim(id);
    }

    function test_Sec_InvalidGiftId() public {
        bytes memory sig = _sig(claimKey, 999, alice);
        vm.expectRevert(ArcGift.GiftNotFound.selector);
        gift.claim(999, alice, sig);
        vm.expectRevert(ArcGift.GiftNotFound.selector);
        gift.getGift(0);
        vm.expectRevert(ArcGift.GiftNotFound.selector);
        gift.reclaim(999);
        vm.expectRevert(ArcGift.GiftNotFound.selector);
        gift.status(999);
    }

    function test_Sec_UnauthorizedClaim_WrongKey() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        bytes memory sig = _sig(0xBAD, id, alice);
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        gift.claim(id, alice, sig);
    }

    function test_Sec_FrontRunCannotRedirectFunds() public {
        // attacker copies alice's pending signature and swaps in their own address
        uint256 id = _fixed(uint128(10 * USDC), 2);
        bytes memory aliceSig = _sig(claimKey, id, alice);
        vm.prank(carol);
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        gift.claim(id, carol, aliceSig);

        // replaying it verbatim only pays alice
        vm.prank(carol);
        gift.claim(id, alice, aliceSig);
        assertEq(usdc.balanceOf(alice), 5 * USDC);
        assertEq(usdc.balanceOf(carol), 0);

        // and alice's own (now duplicate) tx fails harmlessly
        vm.prank(alice);
        vm.expectRevert(ArcGift.AlreadyClaimed.selector);
        gift.claim(id, alice, aliceSig);
    }

    function test_Sec_SignatureNotReplayableAcrossGifts() public {
        uint256 id1 = _fixed(uint128(10 * USDC), 2);
        uint256 id2 = _fixed(uint128(10 * USDC), 2); // same link key on purpose
        bytes memory sig1 = _sig(claimKey, id1, alice);
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        gift.claim(id2, alice, sig1);
    }

    function test_Sec_SignatureNotReplayableAcrossDeployments() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        ArcGift other = new ArcGift(IERC20(address(usdc)));
        vm.startPrank(sender);
        usdc.approve(address(other), type(uint256).max);
        other.createGift(_params(ArcGift.Mode.Fixed, uint128(10 * USDC), 2, new uint128[](0)));
        vm.stopPrank();
        bytes memory sig = _sig(claimKey, id, alice); // domain = `gift`
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        other.claim(id, alice, sig);
    }

    function test_Sec_SignatureNotReplayableAcrossChains() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.chainId(5042); // e.g. a testnet signature replayed on mainnet
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        gift.claim(id, alice, sig);
    }

    function test_Sec_MalleableSignatureRejected() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimKey, gift.claimDigest(id, alice));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        gift.claim(id, alice, flipped);
    }

    function test_Sec_GarbageSignatureRejected() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        vm.expectRevert(ArcGift.InvalidSignature.selector);
        gift.claim(id, alice, hex"1234");
    }

    function test_Sec_ZeroRecipientRejected() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        bytes memory sig = _sig(claimKey, id, address(0));
        vm.expectRevert(ArcGift.InvalidRecipient.selector);
        gift.claim(id, address(0), sig);
    }

    function test_Sec_RelayedClaimPaysRecipient() public {
        uint256 id = _fixed(uint128(10 * USDC), 2);
        bytes memory sig = _sig(claimKey, id, alice);
        vm.prank(relayer);
        gift.claim(id, alice, sig);
        assertEq(usdc.balanceOf(alice), 5 * USDC);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    function test_Sec_ExpiryBounds() public {
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, 10, 1, new uint128[](0));
        vm.startPrank(sender);
        p.expiresAt = uint40(block.timestamp);
        vm.expectRevert(ArcGift.InvalidExpiry.selector);
        gift.createGift(p);
        p.expiresAt = uint40(block.timestamp + 10 minutes - 1);
        vm.expectRevert(ArcGift.InvalidExpiry.selector);
        gift.createGift(p);
        p.expiresAt = uint40(block.timestamp + 365 days + 1);
        vm.expectRevert(ArcGift.InvalidExpiry.selector);
        gift.createGift(p);
        p.expiresAt = uint40(block.timestamp + 10 minutes);
        gift.createGift(p);
        p.expiresAt = uint40(block.timestamp + 365 days);
        gift.createGift(p);
        vm.stopPrank();
    }

    function test_Sec_CreateValidation() public {
        vm.startPrank(sender);
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, 10, 0, new uint128[](0));
        vm.expectRevert(ArcGift.InvalidRecipients.selector);
        gift.createGift(p);
        p = _params(ArcGift.Mode.Fixed, 1000, 201, new uint128[](0));
        vm.expectRevert(ArcGift.InvalidRecipients.selector);
        gift.createGift(p);
        p = _params(ArcGift.Mode.Fixed, 10, 1, new uint128[](0));
        p.claimSigner = address(0);
        vm.expectRevert(ArcGift.InvalidClaimSigner.selector);
        gift.createGift(p);
        p = _params(ArcGift.Mode.Random, 0, 0, new uint128[](0));
        vm.expectRevert(ArcGift.InvalidRecipients.selector);
        gift.createGift(p);
        vm.stopPrank();
    }

    function test_Sec_NoApprovalNoGift() public {
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, uint128(10 * USDC), 1, new uint128[](0));
        vm.prank(alice); // alice has no USDC and no approval
        vm.expectRevert();
        gift.createGift(p);
        assertEq(gift.nextGiftId(), 1);
    }

    function test_Sec_FeeOnTransferDepositRejected() public {
        FeeToken fee = new FeeToken();
        ArcGift g2 = new ArcGift(IERC20(address(fee)));
        fee.mint(sender, 100 * USDC);
        ArcGift.CreateParams memory p = _params(ArcGift.Mode.Fixed, uint128(100 * USDC), 1, new uint128[](0));
        vm.startPrank(sender);
        fee.approve(address(g2), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(ArcGift.DepositMismatch.selector, 99 * USDC, 100 * USDC));
        g2.createGift(p);
        vm.stopPrank();
    }

    function test_Sec_ZeroTokenRejected() public {
        vm.expectRevert(ArcGift.InvalidToken.selector);
        new ArcGift(IERC20(address(0)));
    }

    // ============================================================ FUZZ

    function testFuzz_FixedSumIsExact(uint128 total, uint16 n) public {
        n = uint16(bound(n, 1, 200));
        total = uint128(bound(total, n, 1_000_000_000 * USDC));
        uint256 id = _fixed(total, n);
        uint256[] memory a = gift.getAllocations(id);
        uint256 sum;
        for (uint256 i; i < a.length; ++i) {
            assertGt(a[i], 0);
            assertLe(a[0] - a[i], 1); // fixed slots never differ by more than 1 base unit
            sum += a[i];
        }
        assertEq(sum, total);
    }

    function testFuzz_RandomConservation(uint256 seed, uint8 nRaw, uint8 claims, uint32 elapsed) public {
        uint256 n = bound(nRaw, 1, 40);
        uint128[] memory allocs = new uint128[](n);
        uint128 total;
        for (uint256 i; i < n; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            allocs[i] = uint128(bound(uint256(keccak256(abi.encode(seed, i))), 1, 1_000 * USDC));
            total += allocs[i];
        }
        uint256 id = _random(allocs);

        uint256 k = bound(claims, 0, n);
        uint256 paid;
        for (uint256 i; i < k; ++i) {
            paid += _claim(id, address(uint160(0x1000 + i)));
        }
        assertEq(gift.remaining(id) + paid, total);
        assertEq(usdc.balanceOf(address(gift)), total - paid);

        vm.warp(block.timestamp + 1 days + bound(elapsed, 0, 365 days));
        if (paid < total) {
            vm.prank(sender);
            assertEq(gift.reclaim(id), total - paid);
        }
        assertEq(usdc.balanceOf(address(gift)), 0);
    }
}

/// Reentrancy: a malicious token calls back into ArcGift during transfers.
contract ArcGiftReentrancyTest is Test, IReenter {
    HookToken token;
    ArcGift gift;
    uint256 claimKey = 0xC1A1;
    uint256 targetId;
    bytes pendingSig;
    bool reenterReclaim;

    function setUp() public {
        token = new HookToken();
        gift = new ArcGift(IERC20(address(token)));
        token.mint(address(this), 100e6);
        token.approve(address(gift), type(uint256).max);
        targetId = gift.createGift(
            ArcGift.CreateParams({
                mode: ArcGift.Mode.Fixed,
                totalAmount: 10e6,
                recipients: 2,
                allocations: new uint128[](0),
                expiresAt: uint40(block.timestamp + 1 days),
                claimSigner: vm.addr(claimKey),
                message: ""
            })
        );
        token.setHook(address(this));
    }

    function reenter() external override {
        if (reenterReclaim) gift.reclaim(targetId);
        else gift.claim(targetId, address(this), pendingSig);
    }

    function test_ReentrantClaimBlocked() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimKey, gift.claimDigest(targetId, address(this)));
        pendingSig = abi.encodePacked(r, s, v);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        gift.claim(targetId, address(this), pendingSig);
    }

    function test_ReentrantReclaimBlocked() public {
        reenterReclaim = true;
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        gift.reclaim(targetId); // refund to us triggers reenter() → reclaim again
    }
}
