// Contract access for the v2 relayer. The relayer holds NO meter keys: it pays gas, deposits for the
// shop (simulated custodial buyer wallet) and submits readings the meters signed themselves.
import { ethers } from 'ethers';
import { chain, TRADE } from './config.js';
import { domainFor, structOf } from './signing.js';

export const ABI = [
  'function openTrade(address seller, uint256 pricePerWh, uint64 maxWh, uint64 duration) payable returns (uint256)',
  'function settleTrade(uint256 id, (uint256 tradeId, address meter, uint64 wh, uint16 socBpsAfter, uint64 timestamp) s, bytes sellerSig, (uint256 tradeId, address meter, uint64 wh, uint64 timestamp) b, bytes buyerSig)',
  'function trades(uint256) view returns (address seller, address buyer, address sellerMeter, address buyerMeter, uint64 maxWh, uint64 expiresAt, uint8 status, uint16 toleranceBps, uint16 utilityBps, uint16 platformBps, uint256 pricePerWh, uint256 deposit)',
  'function meterOf(address) view returns (address)',
  'function totalDeliveredWh() view returns (uint256)',
  'function MIN_SOC_BPS() view returns (uint16)',
  'event TradeOpened(uint256 indexed id, address indexed seller, address indexed buyer, uint64 maxWh, uint256 pricePerWh, uint64 expiresAt)',
  'event TradeSettled(uint256 indexed id, uint64 deliveredWh, uint256 amount, uint256 sellerShare, uint256 utilityShare, uint256 platformShare, uint256 buyerRefund)',
  'event TradeDisputed(uint256 indexed id, uint64 sellerWh, uint64 buyerWh)',
];
export const STATUS = ['None', 'Open', 'Disputed', 'Settled', 'Refunded'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connectChain() {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
  const { chainId } = await provider.getNetwork();
  const relayer = new ethers.Wallet(chain.relayerKey, provider);
  const buyer = new ethers.Wallet(chain.buyerKey, provider);
  const escrow = new ethers.Contract(chain.escrow, ABI, provider);
  const domain = domainFor(chainId, chain.escrow);
  const minSocBps = Number(await escrow.MIN_SOC_BPS());

  const parse = (receipt) =>
    receipt.logs.map((l) => { try { return escrow.interface.parseLog(l); } catch { return null; } }).filter(Boolean);

  async function openTrade() {
    const deposit = TRADE.maxWh * TRADE.pricePerWh;
    const tx = await escrow.connect(buyer).openTrade(chain.sellerAddress, TRADE.pricePerWh, TRADE.maxWh, TRADE.durationS, { value: deposit });
    const receipt = await tx.wait();
    const ev = parse(receipt).find((e) => e.name === 'TradeOpened');
    return { id: Number(ev.args.id), txHash: receipt.hash };
  }

  /** trades(id), retried while a lagging public RPC node still shows the old state. */
  async function tradeInfo(id, notStatus = null) {
    for (let i = 0; i < 6; i++) {
      const t = await escrow.trades(id);
      if (notStatus === null || STATUS[Number(t.status)] !== notStatus) return t;
      await sleep(1000);
    }
    return escrow.trades(id);
  }

  async function settle(id, seller, buyerReading) {
    const tx = await escrow.connect(relayer).settleTrade(id, structOf(seller), seller.signature, structOf(buyerReading), buyerReading.signature);
    const receipt = await tx.wait();
    for (const e of parse(receipt)) {
      if (e.name === 'TradeSettled') return { outcome: 'SETTLED', txHash: receipt.hash, deliveredWh: Number(e.args.deliveredWh) };
      if (e.name === 'TradeDisputed') return { outcome: 'DISPUTED', txHash: receipt.hash, sellerWh: Number(e.args.sellerWh), buyerWh: Number(e.args.buyerWh) };
    }
    return { outcome: 'UNKNOWN', txHash: receipt.hash };
  }

  return { provider, chainId, escrow, domain, minSocBps, relayer, buyer, openTrade, tradeInfo, settle };
}
