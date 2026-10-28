// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AegisEscrow
/// @notice Prototype escrow for peer-to-peer energy trades. A trade is settled only when the
///         seller's meter and the buyer's meter both sign a reading and the two readings agree
///         within a tolerance (the gap is cable loss).
/// @dev Hackathon prototype for a testnet. NOT audited. Settles in the chain's native test coin.
///      Energy is counted in integer watt-hours (Wh), money in wei, ratios in basis points (1/10_000).
///      Ratios and fee shares are design parameters, not measured results.
contract AegisEscrow is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    // ------------------------------------------------------------------ types

    enum Status {
        None,
        Open,
        Disputed,
        Settled,
        Refunded
    }

    struct Trade {
        address seller;
        address buyer;
        address sellerMeter; // meter signer snapshot taken when the trade is opened
        address buyerMeter;
        uint64 maxWh;
        uint64 expiresAt;
        Status status;
        uint16 toleranceBps; // snapshot of the parameters in force when the trade was opened
        uint16 utilityBps;
        uint16 platformBps;
        uint256 pricePerWh; // wei per Wh
        uint256 deposit; // wei held in escrow (maxWh * pricePerWh)
    }

    /// @notice Reading signed by the seller's meter (EIP-712).
    struct SellerReading {
        uint256 tradeId;
        address meter;
        uint64 wh; // energy sent out
        uint16 socBpsAfter; // battery state of charge after discharging, basis points
        uint64 timestamp;
    }

    /// @notice Reading signed by the buyer's meter (EIP-712).
    struct BuyerReading {
        uint256 tradeId;
        address meter;
        uint64 wh; // energy received
        uint64 timestamp;
    }

    // -------------------------------------------------------------- constants

    bytes32 private constant SELLER_READING_TYPEHASH =
        keccak256("SellerReading(uint256 tradeId,address meter,uint64 wh,uint16 socBpsAfter,uint64 timestamp)");
    bytes32 private constant BUYER_READING_TYPEHASH =
        keccak256("BuyerReading(uint256 tradeId,address meter,uint64 wh,uint64 timestamp)");

    uint16 public constant BPS = 10_000;
    /// @dev Design parameter: the battery must not be discharged below 5% state of charge (v2, matches the
    ///      Wokwi Stage 4E battery reserve). v1 used 20%; changing it requires a new deployment.
    uint16 public constant MIN_SOC_BPS = 500;
    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 7 days;
    /// @dev How long the arbiter has to resolve a dispute after the trade expires.
    uint64 public constant DISPUTE_WINDOW = 7 days;

    // ---------------------------------------------------------------- storage

    // Parameters applied to NEW trades (illustrative values, tune and justify them in the README).
    uint16 public toleranceBps = 300; // max gap between seller and buyer readings: 3%
    uint16 public utilityBps = 1_500; // share of each payment returned to the utility: 15%
    uint16 public platformBps = 200; // platform fee: 2%. The seller receives the remainder.

    address public utilityRecipient;
    address public platformRecipient;

    uint256 public nextTradeId = 1;
    /// @notice Cumulative energy delivered by settled trades (Wh). The dashboard reads this for impact figures.
    uint256 public totalDeliveredWh;

    mapping(uint256 => Trade) public trades;
    mapping(address => address) public meterOf; // account => meter signer address
    mapping(address => address) public accountOfMeter; // meter signer address => account
    mapping(address => uint256) public withdrawable; // pull-payment balances (wei)

    // ----------------------------------------------------------------- events

    event MeterRegistered(address indexed account, address indexed meter);
    event TradeOpened(
        uint256 indexed id,
        address indexed seller,
        address indexed buyer,
        uint64 maxWh,
        uint256 pricePerWh,
        uint64 expiresAt
    );
    event TradeSettled(
        uint256 indexed id,
        uint64 deliveredWh,
        uint256 amount,
        uint256 sellerShare,
        uint256 utilityShare,
        uint256 platformShare,
        uint256 buyerRefund
    );
    event TradeDisputed(uint256 indexed id, uint64 sellerWh, uint64 buyerWh);
    event TradeRefunded(uint256 indexed id, address indexed buyer, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event ParamsUpdated(uint16 toleranceBps, uint16 utilityBps, uint16 platformBps);
    event RecipientsUpdated(address utilityRecipient, address platformRecipient);

    // ----------------------------------------------------------------- errors

    error InvalidAddress();
    error InvalidParams();
    error ZeroValue();
    error MeterAlreadyUsed();
    error NotRegistered();
    error SelfTrade();
    error InvalidDuration();
    error WrongDeposit();
    error NotOpen();
    error NotDisputed();
    error Expired();
    error NotExpired();
    error ReadingForOtherTrade();
    error WrongMeter();
    error FutureTimestamp();
    error BadSignature();
    error ExceedsMax();
    error DepthOfDischarge();
    error NothingToWithdraw();
    error TransferFailed();

    // ------------------------------------------------------------ constructor

    constructor(address utility, address platform) EIP712("AegisGrid", "1") Ownable(msg.sender) {
        if (utility == address(0) || platform == address(0)) revert InvalidAddress();
        utilityRecipient = utility;
        platformRecipient = platform;
    }

    // --------------------------------------------------------------- metering

    /// @notice Register (or replace) the address whose key signs this account's meter readings.
    function registerMeter(address meter) external {
        if (meter == address(0)) revert InvalidAddress();
        address current = accountOfMeter[meter];
        if (current != address(0) && current != msg.sender) revert MeterAlreadyUsed();

        address old = meterOf[msg.sender];
        if (old != address(0)) delete accountOfMeter[old];

        meterOf[msg.sender] = meter;
        accountOfMeter[meter] = msg.sender;
        emit MeterRegistered(msg.sender, meter);
    }

    // ----------------------------------------------------------------- trades

    /// @notice The buyer opens a trade and escrows the maximum payment (maxWh * pricePerWh).
    function openTrade(address seller, uint256 pricePerWh, uint64 maxWh, uint64 duration)
        external
        payable
        whenNotPaused
        returns (uint256 id)
    {
        if (seller == msg.sender) revert SelfTrade();
        address sellerMeter = meterOf[seller];
        address buyerMeter = meterOf[msg.sender];
        if (sellerMeter == address(0) || buyerMeter == address(0)) revert NotRegistered();
        if (pricePerWh == 0 || maxWh == 0) revert ZeroValue();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();

        uint256 deposit = uint256(maxWh) * pricePerWh; // reverts on overflow
        if (msg.value != deposit) revert WrongDeposit();

        id = nextTradeId++;
        Trade storage t = trades[id];
        t.seller = seller;
        t.buyer = msg.sender;
        t.sellerMeter = sellerMeter;
        t.buyerMeter = buyerMeter;
        t.maxWh = maxWh;
        t.expiresAt = uint64(block.timestamp) + duration;
        t.status = Status.Open;
        t.toleranceBps = toleranceBps;
        t.utilityBps = utilityBps;
        t.platformBps = platformBps;
        t.pricePerWh = pricePerWh;
        t.deposit = deposit;

        emit TradeOpened(id, seller, msg.sender, maxWh, pricePerWh, t.expiresAt);
    }

    /// @notice Anyone (for example the bridge) may submit the two signed readings.
    ///         If they agree within tolerance the trade settles; otherwise it is frozen as Disputed
    ///         and the funds stay in escrow until the arbiter resolves it or the dispute window ends.
    function settleTrade(
        uint256 id,
        SellerReading calldata s,
        bytes calldata sellerSig,
        BuyerReading calldata b,
        bytes calldata buyerSig
    ) external whenNotPaused nonReentrant {
        Trade storage t = trades[id];
        if (t.status != Status.Open) revert NotOpen();
        if (block.timestamp > t.expiresAt) revert Expired();
        if (s.tradeId != id || b.tradeId != id) revert ReadingForOtherTrade();
        if (s.meter != t.sellerMeter || b.meter != t.buyerMeter) revert WrongMeter();
        if (s.timestamp > block.timestamp || b.timestamp > block.timestamp) revert FutureTimestamp();
        if (ECDSA.recover(sellerDigest(s), sellerSig) != s.meter) revert BadSignature();
        if (ECDSA.recover(buyerDigest(b), buyerSig) != b.meter) revert BadSignature();
        if (s.wh == 0 || b.wh == 0) revert ZeroValue();
        if (s.wh > t.maxWh || b.wh > t.maxWh) revert ExceedsMax();
        if (s.socBpsAfter < MIN_SOC_BPS || s.socBpsAfter > BPS) revert DepthOfDischarge();

        // The seller's meter sends out at least what the buyer's meter receives.
        // The difference is cable loss and must stay within the tolerance (cross-multiplied: no rounding).
        bool agree = b.wh <= s.wh && (uint256(s.wh) - b.wh) * BPS <= uint256(s.wh) * t.toleranceBps;

        if (agree) {
            _payout(id, t, b.wh); // pay for what the buyer actually received
        } else {
            t.status = Status.Disputed;
            emit TradeDisputed(id, s.wh, b.wh);
        }
    }

    /// @notice Arbiter (owner) settles a disputed trade for the energy it decides was delivered.
    /// @dev Prototype centralisation. A production design needs staking and slashing or a decentralised oracle.
    function resolveDispute(uint256 id, uint64 acceptedWh) external onlyOwner {
        Trade storage t = trades[id];
        if (t.status != Status.Disputed) revert NotDisputed();
        if (acceptedWh > t.maxWh) revert ExceedsMax();
        _payout(id, t, acceptedWh); // acceptedWh == 0 refunds the buyer in full
    }

    /// @notice Return the escrow to the buyer when nobody settled in time (also frees stuck disputes).
    function refundExpired(uint256 id) external {
        Trade storage t = trades[id];
        if (t.status == Status.Open) {
            if (block.timestamp <= t.expiresAt) revert NotExpired();
        } else if (t.status == Status.Disputed) {
            if (block.timestamp <= uint256(t.expiresAt) + DISPUTE_WINDOW) revert NotExpired();
        } else {
            revert NotOpen();
        }
        t.status = Status.Refunded;
        _credit(t.buyer, t.deposit);
        emit TradeRefunded(id, t.buyer, t.deposit);
    }

    /// @notice Pull-payment: withdraw everything credited to the caller.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0; // effects before interaction
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ admin

    /// @dev Pausing stops new trades and settlements. Refunds, disputes and withdrawals keep working.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update the parameters used for NEW trades. Open trades keep their snapshot.
    function setParams(uint16 newToleranceBps, uint16 newUtilityBps, uint16 newPlatformBps) external onlyOwner {
        if (newToleranceBps > 1_000) revert InvalidParams(); // tolerance at most 10%
        if (newPlatformBps > 1_000) revert InvalidParams(); // platform fee at most 10%
        if (uint256(newUtilityBps) + newPlatformBps > BPS) revert InvalidParams();
        toleranceBps = newToleranceBps;
        utilityBps = newUtilityBps;
        platformBps = newPlatformBps;
        emit ParamsUpdated(newToleranceBps, newUtilityBps, newPlatformBps);
    }

    function setRecipients(address newUtility, address newPlatform) external onlyOwner {
        if (newUtility == address(0) || newPlatform == address(0)) revert InvalidAddress();
        utilityRecipient = newUtility;
        platformRecipient = newPlatform;
        emit RecipientsUpdated(newUtility, newPlatform);
    }

    // ------------------------------------------------------------------ views

    /// @notice EIP-712 digest the seller's meter must sign. Handy for debugging signature mismatches.
    function sellerDigest(SellerReading calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(SELLER_READING_TYPEHASH, r.tradeId, r.meter, r.wh, r.socBpsAfter, r.timestamp))
        );
    }

    /// @notice EIP-712 digest the buyer's meter must sign.
    function buyerDigest(BuyerReading calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BUYER_READING_TYPEHASH, r.tradeId, r.meter, r.wh, r.timestamp)));
    }

    // --------------------------------------------------------------- internal

    function _payout(uint256 id, Trade storage t, uint64 wh) private {
        uint256 amount = uint256(wh) * t.pricePerWh; // wh <= maxWh, so amount <= deposit
        uint256 refund = t.deposit - amount;
        uint256 platformShare = (amount * t.platformBps) / BPS;
        uint256 utilityShare = (amount * t.utilityBps) / BPS;
        uint256 sellerShare = amount - platformShare - utilityShare; // remainder: no dust is lost

        t.status = Status.Settled;
        totalDeliveredWh += wh;

        _credit(t.seller, sellerShare);
        _credit(utilityRecipient, utilityShare);
        _credit(platformRecipient, platformShare);
        _credit(t.buyer, refund);

        emit TradeSettled(id, wh, amount, sellerShare, utilityShare, platformShare, refund);
    }

    function _credit(address to, uint256 amount) private {
        if (amount != 0) withdrawable[to] += amount;
    }
}
