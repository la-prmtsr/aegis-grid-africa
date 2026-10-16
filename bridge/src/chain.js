// Everything that talks to the AegisEscrow contract.
import { ethers } from 'ethers';
import { chain, TRADE } from './config.js';

// Only the functions and events the bridge uses (human-readable ABI).
const ABI = [
  'function openTrade(address seller, uint256 pricePerWh, uint64 maxWh, uint64 duration) payable returns (uint256)',
  'function settleTrade(uint256 id, (uint256 tradeId, address meter, uint64 wh, uint16 socBpsAfter, uint64 timestamp) s, bytes sellerSig, (uint256 tradeId, address meter, uint64 wh, uint64 timestamp) b, bytes buyerSig)',
  'function trades(uint256) view returns (address seller, address buyer, address sellerMeter, address buyerMeter, uint64 maxWh, uint64 expiresAt, uint8 status, uint16 toleranceBps, uint16 utilityBps, uint16 platformBps, uint256 pricePerWh, uint256 deposit)',
  'function totalDeliveredWh() view returns (uint256)',
  'event TradeOpened(uint256 indexed id, address indexed seller, address indexed buyer, uint64 maxWh, uint256 pricePerWh, uint64 expiresAt)',
  'event TradeSettled(uint256 indexed id, uint64 deliveredWh, uint256 amount, uint256 sellerShare, uint256 utilityShare, uint256 platformShare, uint256 buyerRefund)',
  'event TradeDisputed(uint256 indexed id, uint64 sellerWh, uint64 buyerWh)',
];

export const STATUS = ['None', 'Open', 'Disputed', 'Settled', 'Refunded'];

// EIP-712 types: must match the Solidity structs exactly (names, types and order).
const SELLER_TYPES = {
  SellerReading: [
    { name: 'tradeId', type: 'uint256' },
    { name: 'meter', type: 'address' },
    { name: 'wh', type: 'uint64' },
    { name: 'socBpsAfter', type: 'uint16' },
    { name: 'timestamp', type: 'uint64' },
  ],
};
const BUYER_TYPES = {
  BuyerReading: [
    { name: 'tradeId', type: 'uint256' },
    { name: 'meter', type: 'address' },
    { name: 'wh', type: 'uint64' },
    { name: 'timestamp', type: 'uint64' },
  ],
};

export async function connectChain() {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const { chainId } = await provider.getNetwork();

  const relayer = new ethers.Wallet(chain.relayerKey, provider); // pays gas for settleTrade
  const buyer = new ethers.Wallet(chain.buyerKey, provider); // the shop, deposits into escrow
  const sellerMeter = new ethers.Wallet(chain.sellerMeterKey); // signs readings only, no network
  const buyerMeter = new ethers.Wallet(chain.buyerMeterKey);

  const escrow = new ethers.Contract(chain.escrow, ABI, provider);
  const domain = { name: 'AegisGrid', version: '1', chainId, verifyingContract: chain.escrow };

  // Buyer opens a trade with the seller and escrows maxWh * pricePerWh. Returns { id, txHash }.
  async function openTrade() {
    const deposit = TRADE.maxWh * TRADE.pricePerWh;
    const tx = await escrow
      .connect(buyer)
      .openTrade(chain.sellerAddress, TRADE.pricePerWh, TRADE.maxWh, TRADE.durationS, { value: deposit });
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => { try { return escrow.interface.parseLog(log); } catch { return null; } })
      .find((e) => e?.name === 'TradeOpened');
    return { id: Number(event.args.id), txHash: receipt.hash };
  }

  // Sign both final readings with the meter keys and submit them. Returns the outcome.
  async function settleTrade(id, sellerFinal, buyerFinal) {
    // Use the chain's clock, slightly in the past, so the contract never sees a future timestamp.
    const block = await provider.getBlock('latest');
    const timestamp = BigInt(block.timestamp - 5);

    const s = {
      tradeId: BigInt(id),
      meter: sellerMeter.address,
      wh: BigInt(sellerFinal.wh),
      socBpsAfter: Number(sellerFinal.socBpsAfter),
      timestamp,
    };
    const b = { tradeId: BigInt(id), meter: buyerMeter.address, wh: BigInt(buyerFinal.wh), timestamp };

    const sellerSig = await sellerMeter.signTypedData(domain, SELLER_TYPES, s);
    const buyerSig = await buyerMeter.signTypedData(domain, BUYER_TYPES, b);

    const tx = await escrow.connect(relayer).settleTrade(id, s, sellerSig, b, buyerSig);
    const receipt = await tx.wait();

    for (const log of receipt.logs) {
      let e;
      try { e = escrow.interface.parseLog(log); } catch { continue; }
      if (e?.name === 'TradeSettled') {
        return { outcome: 'SETTLED', txHash: receipt.hash, deliveredWh: Number(e.args.deliveredWh), amountWei: e.args.amount };
      }
      if (e?.name === 'TradeDisputed') {
        return { outcome: 'DISPUTED', txHash: receipt.hash, sellerWh: Number(e.args.sellerWh), buyerWh: Number(e.args.buyerWh) };
      }
    }
    return { outcome: 'UNKNOWN', txHash: receipt.hash };
  }

  return { chainId, escrow, openTrade, settleTrade, sellerMeter, buyerMeter };
}