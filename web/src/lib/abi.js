// Human-readable ABI for contracts/src/AegisEscrow.sol (only what the web app uses).
// If you change the contract, update this list.
export const ESCROW_ABI = [
  // reads
  'function trades(uint256) view returns (address seller, address buyer, address sellerMeter, address buyerMeter, uint64 maxWh, uint64 expiresAt, uint8 status, uint16 toleranceBps, uint16 utilityBps, uint16 platformBps, uint256 pricePerWh, uint256 deposit)',
  'function totalDeliveredWh() view returns (uint256)',
  'function nextTradeId() view returns (uint256)',
  'function withdrawable(address) view returns (uint256)',
  'function meterOf(address) view returns (address)',
  'function toleranceBps() view returns (uint16)',
  'function utilityBps() view returns (uint16)',
  'function platformBps() view returns (uint16)',
  'function utilityRecipient() view returns (address)',
  'function platformRecipient() view returns (address)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function DISPUTE_WINDOW() view returns (uint64)',
  // writes (sent from the connected browser wallet)
  'function registerMeter(address meter)',
  'function withdraw()',
  'function resolveDispute(uint256 id, uint64 acceptedWh)',
  'function refundExpired(uint256 id)',
  // events
  'event MeterRegistered(address indexed account, address indexed meter)',
  'event TradeOpened(uint256 indexed id, address indexed seller, address indexed buyer, uint64 maxWh, uint256 pricePerWh, uint64 expiresAt)',
  'event TradeSettled(uint256 indexed id, uint64 deliveredWh, uint256 amount, uint256 sellerShare, uint256 utilityShare, uint256 platformShare, uint256 buyerRefund)',
  'event TradeDisputed(uint256 indexed id, uint64 sellerWh, uint64 buyerWh)',
  'event TradeRefunded(uint256 indexed id, address indexed buyer, uint256 amount)',
  'event Withdrawn(address indexed account, uint256 amount)',
  // custom errors (so ethers can name a revert)
  ...['InvalidAddress', 'InvalidParams', 'ZeroValue', 'MeterAlreadyUsed', 'NotRegistered', 'SelfTrade', 'InvalidDuration',
    'WrongDeposit', 'NotOpen', 'NotDisputed', 'Expired', 'NotExpired', 'ReadingForOtherTrade', 'WrongMeter', 'FutureTimestamp',
    'BadSignature', 'ExceedsMax', 'DepthOfDischarge', 'NothingToWithdraw', 'TransferFailed', 'EnforcedPause', 'ReentrancyGuardReentrantCall']
    .map((n) => `error ${n}()`),
  'error OwnableUnauthorizedAccount(address account)',
];

export const STATUS = ['None', 'Open', 'Disputed', 'Settled', 'Refunded'];

// Custom errors, so a reverted wallet transaction can be explained in plain words.
export const ERROR_TEXT = {
  NotRegistered: 'One of the two accounts has no registered meter.',
  MeterAlreadyUsed: 'That meter address is already registered to another account.',
  InvalidAddress: 'The address is not valid.',
  NothingToWithdraw: 'There is nothing to withdraw for this account.',
  NotDisputed: 'This trade is not disputed.',
  NotExpired: 'The trade has not expired yet. Refunds open after expiry (disputes: after the 7-day window).',
  NotOpen: 'This trade is not open any more.',
  ExceedsMax: 'The accepted energy is larger than the trade maximum.',
  OwnableUnauthorizedAccount: 'Only the contract owner (arbiter) can do this.',
  EnforcedPause: 'The contract is paused.',
};
