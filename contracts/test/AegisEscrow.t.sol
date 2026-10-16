// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AegisEscrow} from "../src/AegisEscrow.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev Re-enters withdraw() from receive(). Used to show a double payout is impossible.
contract ReentrantSeller {
    AegisEscrow public esc;
    uint256 public hits;

    constructor(AegisEscrow e) {
        esc = e;
    }

    function register(address meter) external {
        esc.registerMeter(meter);
    }

    function pull() external {
        esc.withdraw();
    }

    receive() external payable {
        hits++;
        if (hits < 3) {
            try esc.withdraw() {} catch {}
        }
    }
}

contract AegisEscrowTest is Test {
    AegisEscrow esc;

    address utility = makeAddr("utility");
    address platform = makeAddr("platform");
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address relayer = makeAddr("relayer");

    uint256 constant SELLER_METER_PK = 0xA11CE;
    uint256 constant BUYER_METER_PK = 0xB0B;
    uint256 constant PRICE = 1e12; // wei per Wh (illustrative)
    uint64 constant MAX_WH = 1000;

    address sellerMeter;
    address buyerMeter;

    function setUp() public {
        vm.warp(1_790_000_000);
        esc = new AegisEscrow(utility, platform);
        sellerMeter = vm.addr(SELLER_METER_PK);
        buyerMeter = vm.addr(BUYER_METER_PK);
        vm.prank(seller);
        esc.registerMeter(sellerMeter);
        vm.prank(buyer);
        esc.registerMeter(buyerMeter);
        vm.deal(buyer, 100 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _open() internal returns (uint256 id) {
        vm.prank(buyer);
        id = esc.openTrade{value: uint256(MAX_WH) * PRICE}(seller, PRICE, MAX_WH, 1 hours);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _s(uint256 id, uint64 wh, uint16 soc) internal view returns (AegisEscrow.SellerReading memory) {
        return AegisEscrow.SellerReading(id, sellerMeter, wh, soc, uint64(block.timestamp));
    }

    function _b(uint256 id, uint64 wh) internal view returns (AegisEscrow.BuyerReading memory) {
        return AegisEscrow.BuyerReading(id, buyerMeter, wh, uint64(block.timestamp));
    }

    function _settle(uint256 id, AegisEscrow.SellerReading memory s, AegisEscrow.BuyerReading memory b) internal {
        bytes memory ssig = _sig(SELLER_METER_PK, esc.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, esc.buyerDigest(b));
        vm.prank(relayer); // untrusted relayer: anyone may submit
        esc.settleTrade(id, s, ssig, b, bsig);
    }

    /// @dev Signs first, so that expectRevert applies to settleTrade and not to the digest view calls.
    function _settleReverts(
        uint256 id,
        AegisEscrow.SellerReading memory s,
        AegisEscrow.BuyerReading memory b,
        bytes4 err
    ) internal {
        bytes memory ssig = _sig(SELLER_METER_PK, esc.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, esc.buyerDigest(b));
        vm.prank(relayer);
        vm.expectRevert(err);
        esc.settleTrade(id, s, ssig, b, bsig);
    }

    function _status(uint256 id) internal view returns (AegisEscrow.Status st) {
        (,,,,,, st,,,,,) = esc.trades(id);
    }

    // ------------------------------------------------------------------ tests

    /// 1. Happy path: 2% cable loss settles, shares add up, withdraw pays once.
    function test_HappyPath_SplitAndWithdraw() public {
        uint256 id = _open();
        _settle(id, _s(id, 500, 5000), _b(id, 490));

        assertEq(uint8(_status(id)), uint8(AegisEscrow.Status.Settled));
        assertEq(esc.totalDeliveredWh(), 490);

        uint256 amount = 490 * PRICE;
        uint256 platformShare = (amount * 200) / 10_000;
        uint256 utilityShare = (amount * 1_500) / 10_000;
        uint256 sellerShare = amount - platformShare - utilityShare;
        uint256 refund = uint256(MAX_WH) * PRICE - amount;

        assertEq(esc.withdrawable(seller), sellerShare);
        assertEq(esc.withdrawable(utility), utilityShare);
        assertEq(esc.withdrawable(platform), platformShare);
        assertEq(esc.withdrawable(buyer), refund);
        assertEq(sellerShare + utilityShare + platformShare + refund, uint256(MAX_WH) * PRICE);

        vm.prank(seller);
        esc.withdraw();
        assertEq(seller.balance, sellerShare);
        vm.prank(seller);
        vm.expectRevert(AegisEscrow.NothingToWithdraw.selector);
        esc.withdraw();
    }

    /// 2. Tolerance boundary: exactly 3% settles, 3.1% is disputed.
    function test_ToleranceBoundary() public {
        uint256 a = _open();
        _settle(a, _s(a, 1000, 5000), _b(a, 970));
        assertEq(uint8(_status(a)), uint8(AegisEscrow.Status.Settled));

        uint256 b = _open();
        _settle(b, _s(b, 1000, 5000), _b(b, 969));
        assertEq(uint8(_status(b)), uint8(AegisEscrow.Status.Disputed));
    }

    /// 3. Buyer reads more than the seller sent: disputed.
    function test_BuyerReadsMore_Disputed() public {
        uint256 id = _open();
        _settle(id, _s(id, 500, 5000), _b(id, 501));
        assertEq(uint8(_status(id)), uint8(AegisEscrow.Status.Disputed));
    }

    /// 4. Fraud (tampered buyer meter under-reports): funds frozen, seller unpaid, counter unchanged.
    function test_Fraud_FrozenAsDisputed() public {
        uint256 id = _open();
        vm.expectEmit(true, false, false, true);
        emit AegisEscrow.TradeDisputed(id, 500, 300);
        _settle(id, _s(id, 500, 5000), _b(id, 300));

        assertEq(uint8(_status(id)), uint8(AegisEscrow.Status.Disputed));
        assertEq(esc.withdrawable(seller), 0);
        assertEq(esc.withdrawable(buyer), 0);
        assertEq(esc.totalDeliveredWh(), 0);
        assertEq(address(esc).balance, uint256(MAX_WH) * PRICE);
    }

    /// 5. Dispute resolution: owner only, bounded, once.
    function test_ResolveDispute() public {
        uint256 id = _open();
        _settle(id, _s(id, 500, 5000), _b(id, 300));

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, seller));
        esc.resolveDispute(id, 490);

        vm.expectRevert(AegisEscrow.ExceedsMax.selector);
        esc.resolveDispute(id, MAX_WH + 1);

        esc.resolveDispute(id, 490);
        assertEq(uint8(_status(id)), uint8(AegisEscrow.Status.Settled));
        assertEq(esc.totalDeliveredWh(), 490);

        vm.expectRevert(AegisEscrow.NotDisputed.selector);
        esc.resolveDispute(id, 490);
    }

    function test_ResolveDispute_ZeroRefundsBuyerFully() public {
        uint256 id = _open();
        _settle(id, _s(id, 500, 5000), _b(id, 300));
        esc.resolveDispute(id, 0);
        assertEq(esc.withdrawable(buyer), uint256(MAX_WH) * PRICE);
        assertEq(esc.withdrawable(seller), 0);
    }

    /// 6. A stuck dispute can be refunded only after expiry plus the dispute window.
    function test_StuckDispute_RefundAfterWindow() public {
        uint256 id = _open();
        _settle(id, _s(id, 500, 5000), _b(id, 300));

        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(AegisEscrow.NotExpired.selector);
        esc.refundExpired(id);

        vm.warp(block.timestamp + 7 days);
        esc.refundExpired(id);
        assertEq(uint8(_status(id)), uint8(AegisEscrow.Status.Refunded));
        assertEq(esc.withdrawable(buyer), uint256(MAX_WH) * PRICE);
    }

    /// 7. Replay of the same settlement reverts.
    function test_Replay_Reverts() public {
        uint256 id = _open();
        AegisEscrow.SellerReading memory s = _s(id, 500, 5000);
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        _settle(id, s, b);
        _settleReverts(id, s, b, AegisEscrow.NotOpen.selector);
    }

    /// 8a. A reading signed by the wrong key is rejected.
    function test_WrongSigner_Reverts() public {
        uint256 id = _open();
        AegisEscrow.SellerReading memory s = _s(id, 500, 5000);
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        bytes memory forged = _sig(0xBAD, esc.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, esc.buyerDigest(b));
        vm.expectRevert(AegisEscrow.BadSignature.selector);
        esc.settleTrade(id, s, forged, b, bsig);
    }

    /// 8b. A reading that names another meter is rejected.
    function test_WrongMeter_Reverts() public {
        uint256 id = _open();
        AegisEscrow.SellerReading memory s = _s(id, 500, 5000);
        s.meter = vm.addr(0xBAD);
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        bytes memory ssig = _sig(0xBAD, esc.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, esc.buyerDigest(b));
        vm.expectRevert(AegisEscrow.WrongMeter.selector);
        esc.settleTrade(id, s, ssig, b, bsig);
    }

    /// 8c. A reading for another trade is rejected.
    function test_ReadingForOtherTrade_Reverts() public {
        uint256 id = _open();
        uint256 other = _open();
        AegisEscrow.SellerReading memory s = _s(other, 500, 5000);
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        bytes memory ssig = _sig(SELLER_METER_PK, esc.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, esc.buyerDigest(b));
        vm.expectRevert(AegisEscrow.ReadingForOtherTrade.selector);
        esc.settleTrade(id, s, ssig, b, bsig);
    }

    /// 9. Signatures made for another deployment are rejected (EIP-712 domain binding).
    function test_SignatureForOtherContract_Rejected() public {
        AegisEscrow other = new AegisEscrow(utility, platform);
        uint256 id = _open();
        AegisEscrow.SellerReading memory s = _s(id, 500, 5000);
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        bytes memory ssig = _sig(SELLER_METER_PK, other.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, other.buyerDigest(b));
        vm.expectRevert(AegisEscrow.BadSignature.selector);
        esc.settleTrade(id, s, ssig, b, bsig);
    }

    function test_SignatureForOtherChain_Rejected() public {
        uint256 id = _open();
        AegisEscrow.SellerReading memory s = _s(id, 500, 5000);
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        uint256 original = block.chainid;
        vm.chainId(1);
        bytes memory ssig = _sig(SELLER_METER_PK, esc.sellerDigest(s));
        bytes memory bsig = _sig(BUYER_METER_PK, esc.buyerDigest(b));
        vm.chainId(original);
        vm.expectRevert(AegisEscrow.BadSignature.selector);
        esc.settleTrade(id, s, ssig, b, bsig);
    }

    /// 10. Depth-of-discharge floor (design parameter: 20%).
    function test_DepthOfDischarge() public {
        uint256 a = _open();
        _settleReverts(a, _s(a, 500, 1999), _b(a, 490), AegisEscrow.DepthOfDischarge.selector);

        _settle(a, _s(a, 500, 2000), _b(a, 490));
        assertEq(uint8(_status(a)), uint8(AegisEscrow.Status.Settled));

        uint256 b = _open();
        _settleReverts(b, _s(b, 500, 10_001), _b(b, 490), AegisEscrow.DepthOfDischarge.selector);
    }

    /// 11. Zero and over-maximum readings revert.
    function test_ZeroAndOverMax_Revert() public {
        uint256 id = _open();
        _settleReverts(id, _s(id, 0, 5000), _b(id, 0), AegisEscrow.ZeroValue.selector);
        _settleReverts(id, _s(id, MAX_WH + 1, 5000), _b(id, MAX_WH), AegisEscrow.ExceedsMax.selector);
    }

    /// 12. Future timestamp reverts.
    function test_FutureTimestamp_Reverts() public {
        uint256 id = _open();
        AegisEscrow.SellerReading memory s = _s(id, 500, 5000);
        s.timestamp = uint64(block.timestamp + 60);
        _settleReverts(id, s, _b(id, 490), AegisEscrow.FutureTimestamp.selector);
    }

    /// 13. Expiry: no settlement after expiry, refund only after expiry, no double refund.
    function test_ExpiryAndRefund() public {
        uint256 id = _open();
        vm.expectRevert(AegisEscrow.NotExpired.selector);
        esc.refundExpired(id);

        vm.warp(block.timestamp + 1 hours + 1);
        _settleReverts(id, _s(id, 500, 5000), _b(id, 490), AegisEscrow.Expired.selector);

        esc.refundExpired(id);
        assertEq(esc.withdrawable(buyer), uint256(MAX_WH) * PRICE);
        vm.expectRevert(AegisEscrow.NotOpen.selector);
        esc.refundExpired(id);
    }

    /// 14. openTrade validation.
    function test_OpenTrade_Validation() public {
        vm.startPrank(buyer);
        vm.expectRevert(AegisEscrow.WrongDeposit.selector);
        esc.openTrade{value: 1}(seller, PRICE, MAX_WH, 1 hours);

        vm.expectRevert(AegisEscrow.SelfTrade.selector);
        esc.openTrade{value: uint256(MAX_WH) * PRICE}(buyer, PRICE, MAX_WH, 1 hours);

        vm.expectRevert(AegisEscrow.NotRegistered.selector);
        esc.openTrade{value: uint256(MAX_WH) * PRICE}(makeAddr("stranger"), PRICE, MAX_WH, 1 hours);

        vm.expectRevert(AegisEscrow.InvalidDuration.selector);
        esc.openTrade{value: uint256(MAX_WH) * PRICE}(seller, PRICE, MAX_WH, 5 minutes);

        vm.expectRevert(AegisEscrow.ZeroValue.selector);
        esc.openTrade{value: 0}(seller, 0, MAX_WH, 1 hours);
        vm.stopPrank();
    }

    /// 15. Meter registration rules.
    function test_MeterRegistration() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(AegisEscrow.MeterAlreadyUsed.selector);
        esc.registerMeter(sellerMeter);

        vm.prank(stranger);
        vm.expectRevert(AegisEscrow.InvalidAddress.selector);
        esc.registerMeter(address(0));

        address newMeter = vm.addr(0xC0FFEE);
        vm.prank(seller);
        esc.registerMeter(newMeter);
        assertEq(esc.meterOf(seller), newMeter);
        assertEq(esc.accountOfMeter(sellerMeter), address(0)); // old meter freed

        vm.prank(stranger);
        esc.registerMeter(sellerMeter);
        assertEq(esc.accountOfMeter(sellerMeter), stranger);
    }

    /// 16. Parameters and meters are snapshotted when a trade opens.
    function test_Snapshots() public {
        uint256 id = _open();
        esc.setParams(100, 0, 0); // tighter tolerance for new trades
        vm.prank(seller);
        esc.registerMeter(vm.addr(0xC0FFEE)); // seller swaps meter after opening

        // Old meter and 3% tolerance still apply to the open trade.
        _settle(id, _s(id, 1000, 5000), _b(id, 975));
        assertEq(uint8(_status(id)), uint8(AegisEscrow.Status.Settled));
        assertGt(esc.withdrawable(utility), 0); // old 15% utility share applied
    }

    /// 17. Admin bounds and pause behaviour.
    function test_AdminAndPause() public {
        vm.expectRevert(AegisEscrow.InvalidParams.selector);
        esc.setParams(1_001, 1_500, 200);
        vm.expectRevert(AegisEscrow.InvalidParams.selector);
        esc.setParams(300, 9_500, 600);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, seller));
        esc.setParams(300, 1_500, 200);

        uint256 settled = _open();
        _settle(settled, _s(settled, 500, 5000), _b(settled, 490));
        uint256 open = _open();

        esc.pause();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        esc.openTrade{value: uint256(MAX_WH) * PRICE}(seller, PRICE, MAX_WH, 1 hours);
        _settleReverts(open, _s(open, 500, 5000), _b(open, 490), Pausable.EnforcedPause.selector);

        // Money is never trapped by a pause.
        vm.prank(seller);
        esc.withdraw();
        vm.warp(block.timestamp + 2 hours);
        esc.refundExpired(open);
    }

    /// 18. Plain ETH transfers are rejected.
    function test_PlainTransfer_Rejected() public {
        vm.prank(buyer);
        (bool ok,) = address(esc).call{value: 1 ether}("");
        assertFalse(ok);
    }

    /// 19. Re-entering withdraw from receive() never pays twice, even with other users' funds present.
    function test_Reentrancy_PaidOnce() public {
        ReentrantSeller attacker = new ReentrantSeller(esc);
        address attackerMeter = vm.addr(0xA77AC);
        attacker.register(attackerMeter);

        // Funds of other users sit in the contract.
        uint256 other = _open();
        _settle(other, _s(other, 500, 5000), _b(other, 490));

        vm.prank(buyer);
        uint256 id = esc.openTrade{value: uint256(MAX_WH) * PRICE}(address(attacker), PRICE, MAX_WH, 1 hours);
        AegisEscrow.SellerReading memory s =
            AegisEscrow.SellerReading(id, attackerMeter, 500, 5000, uint64(block.timestamp));
        AegisEscrow.BuyerReading memory b = _b(id, 490);
        esc.settleTrade(id, s, _sig(0xA77AC, esc.sellerDigest(s)), b, _sig(BUYER_METER_PK, esc.buyerDigest(b)));

        uint256 owed = esc.withdrawable(address(attacker));
        uint256 before = address(esc).balance;
        attacker.pull();
        assertEq(address(attacker).balance, owed);
        assertEq(address(esc).balance, before - owed);
    }

    // ------------------------------------------------------------ fuzz tests

    /// Tolerance rule matches a reference formula for any pair of readings.
    function testFuzz_ToleranceMatchesReference(uint64 sWh, uint64 bWh) public {
        sWh = uint64(bound(sWh, 1, MAX_WH));
        bWh = uint64(bound(bWh, 1, MAX_WH));
        uint256 id = _open();
        _settle(id, _s(id, sWh, 5000), _b(id, bWh));

        bool expectAgree = bWh <= sWh && uint256(sWh - bWh) * 10_000 <= uint256(sWh) * 300;
        AegisEscrow.Status expected = expectAgree ? AegisEscrow.Status.Settled : AegisEscrow.Status.Disputed;
        assertEq(uint8(_status(id)), uint8(expected));
    }

    /// Accounting: shares plus refund always equal the deposit; the contract holds exactly what it owes.
    function testFuzz_Accounting(uint64 bWh, uint256 price) public {
        price = bound(price, 1, 1e15);
        bWh = uint64(bound(bWh, 1, MAX_WH));
        uint256 deposit = uint256(MAX_WH) * price;
        vm.prank(buyer);
        uint256 id = esc.openTrade{value: deposit}(seller, price, MAX_WH, 1 hours);
        _settle(id, _s(id, bWh, 5000), _b(id, bWh));

        uint256 credited =
            esc.withdrawable(seller) + esc.withdrawable(utility) + esc.withdrawable(platform) + esc.withdrawable(buyer);
        assertEq(credited, deposit);
        assertEq(address(esc).balance, credited);
    }
}
