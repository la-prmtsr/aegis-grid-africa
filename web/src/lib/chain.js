// Reads the AegisEscrow contract (events + views) and sends wallet transactions.
import { ethers } from 'ethers';
import { CHAIN, ACCOUNTS } from './config.js';
import { ESCROW_ABI, STATUS, ERROR_TEXT } from './abi.js';
import { state, update } from './store.js';
import { providerFor } from './wallets.js';

const iface = new ethers.Interface(ESCROW_ABI);
let provider, escrow;
let lastBlock = 0;
const blockTime = new Map(); // blockNumber -> unix seconds

export function startChain() {
  provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.chainId, { staticNetwork: true });
  escrow = new ethers.Contract(CHAIN.escrow, ESCROW_ABI, provider);
  boot();
}

async function boot() {
  try {
    await refreshViews();
    await loadHistory();
    update({ chain: 'online', chainError: null, historyLoaded: true });
  } catch (err) {
    update({ chain: 'offline', chainError: err.shortMessage || err.message });
    setTimeout(boot, 8000);
    return;
  }
  setInterval(poll, 4000);
  setInterval(() => refreshViews().catch(() => {}), 15000);
}

// ------------------------------------------------------------------ views
async function refreshViews() {
  const [totalDeliveredWh, nextTradeId, toleranceBps, utilityBps, platformBps, owner, paused, balance, block] = await Promise.all([
    escrow.totalDeliveredWh(), escrow.nextTradeId(), escrow.toleranceBps(), escrow.utilityBps(), escrow.platformBps(),
    escrow.owner(), escrow.paused(), provider.getBalance(CHAIN.escrow), provider.getBlockNumber(),
  ]);
  const watch = [ACCOUNTS.seller.address, ACCOUNTS.buyer.address, ACCOUNTS.utility.address, ACCOUNTS.platform.address];
  if (state.wallet?.address) watch.push(state.wallet.address);
  const uniq = [...new Set(watch.map((a) => a.toLowerCase()))];
  const [bal, mtr] = await Promise.all([
    Promise.all(uniq.map((a) => escrow.withdrawable(a))),
    Promise.all(uniq.map((a) => escrow.meterOf(a))),
  ]);
  const withdrawable = {}, meters = {};
  uniq.forEach((a, i) => { withdrawable[a] = bal[i]; meters[a] = mtr[i] === ethers.ZeroAddress ? null : mtr[i]; });
  update({
    totals: { totalDeliveredWh: Number(totalDeliveredWh), nextTradeId: Number(nextTradeId), toleranceBps: Number(toleranceBps),
      utilityBps: Number(utilityBps), platformBps: Number(platformBps), owner, paused, balance },
    withdrawable, meters, block: Math.max(state.block, block),
  });
}

// ----------------------------------------------------------------- events
/** Full event history. Blockscout API first (one request), RPC in block windows as fallback. */
async function loadHistory() {
  const latest = await provider.getBlockNumber();
  let logs = null;
  if (CHAIN.chainId !== 31337) {
    try { logs = await logsFromExplorer(); } catch { logs = null; }
  }
  if (!logs) logs = await logsFromRpc(CHAIN.deployBlock, latest);
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  await addTimes(logs);
  logs.forEach(apply);
  lastBlock = latest;
  await hydrateOpenTrades();
  update({ trades: { ...state.trades }, block: latest });
}

async function logsFromExplorer() {
  const url = `${CHAIN.explorer}/api?module=logs&action=getLogs&address=${CHAIN.escrow}&fromBlock=${CHAIN.deployBlock}&toBlock=latest`;
  const res = await fetch(url);
  const json = await res.json();
  if (!Array.isArray(json.result)) throw new Error('explorer: no result');
  return json.result.map((l) => {
    const blockNumber = Number(l.blockNumber);
    if (l.timeStamp) blockTime.set(blockNumber, Number(l.timeStamp));
    return { topics: l.topics.filter(Boolean), data: l.data, blockNumber, index: Number(l.logIndex || 0), transactionHash: l.transactionHash };
  });
}

async function logsFromRpc(from, to) {
  const out = [];
  const STEP = 9000; // public RPCs cap the block range of eth_getLogs
  const windows = [];
  for (let a = from; a <= to; a += STEP + 1) windows.push([a, Math.min(a + STEP, to)]);
  for (let i = 0; i < windows.length; i += 4) {
    const part = await Promise.all(windows.slice(i, i + 4).map(([a, b]) =>
      provider.getLogs({ address: CHAIN.escrow, fromBlock: a, toBlock: b })));
    part.flat().forEach((l) => out.push({ topics: l.topics, data: l.data, blockNumber: l.blockNumber, index: l.index, transactionHash: l.transactionHash }));
  }
  return out;
}

async function addTimes(logs) {
  const need = [...new Set(logs.map((l) => l.blockNumber))].filter((n) => !blockTime.has(n));
  for (let i = 0; i < need.length; i += 8) {
    const blocks = await Promise.all(need.slice(i, i + 8).map((n) => provider.getBlock(n).catch(() => null)));
    blocks.forEach((b) => b && blockTime.set(b.number, b.timestamp));
  }
  logs.forEach((l) => { l.time = blockTime.get(l.blockNumber) || 0; });
}

function apply(log) {
  let ev;
  try { ev = iface.parseLog({ topics: log.topics, data: log.data }); } catch { return; }
  if (!ev) return;
  const a = ev.args;
  const id = a.id != null ? Number(a.id) : null;
  const t = id ? (state.trades[id] ||= { id, status: 'Open' }) : null;

  switch (ev.name) {
    case 'TradeOpened':
      Object.assign(t, { seller: a.seller, buyer: a.buyer, maxWh: Number(a.maxWh), pricePerWh: a.pricePerWh,
        expiresAt: Number(a.expiresAt), openTx: log.transactionHash, openTime: log.time, openBlock: log.blockNumber });
      if (!t.status || t.status === 'None') t.status = 'Open';
      break;
    case 'TradeSettled':
      Object.assign(t, { status: 'Settled', deliveredWh: Number(a.deliveredWh), amount: a.amount, sellerShare: a.sellerShare,
        utilityShare: a.utilityShare, platformShare: a.platformShare, buyerRefund: a.buyerRefund, settleTx: log.transactionHash, settleTime: log.time });
      break;
    case 'TradeDisputed':
      Object.assign(t, { status: 'Disputed', disputed: true, sellerWh: Number(a.sellerWh), buyerWh: Number(a.buyerWh),
        settleTx: log.transactionHash, settleTime: log.time });
      break;
    case 'TradeRefunded':
      Object.assign(t, { status: 'Refunded', refundAmount: a.amount, refundTx: log.transactionHash, refundTime: log.time });
      break;
    default:
      break; // MeterRegistered / Withdrawn: picked up by refreshViews
  }
}

/** Fill trades that have no TradeOpened in our log window (or status drift) from the trades(id) view. */
async function hydrateOpenTrades() {
  const n = state.totals?.nextTradeId || 1;
  const ids = [];
  for (let i = 1; i < n; i++) if (!state.trades[i]?.seller || state.trades[i].status === 'Open') ids.push(i);
  const rows = await Promise.all(ids.map((i) => escrow.trades(i).catch(() => null)));
  rows.forEach((r, k) => {
    if (!r) return;
    const t = (state.trades[ids[k]] ||= { id: ids[k] });
    Object.assign(t, { seller: r.seller, buyer: r.buyer, maxWh: Number(r.maxWh), pricePerWh: r.pricePerWh, expiresAt: Number(r.expiresAt),
      deposit: r.deposit, toleranceBps: Number(r.toleranceBps), status: STATUS[Number(r.status)] || t.status });
  });
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const latest = await provider.getBlockNumber();
    if (latest > lastBlock) {
      const logs = await logsFromRpc(lastBlock + 1, latest);
      if (logs.length) {
        await addTimes(logs);
        logs.forEach(apply);
        update({ trades: { ...state.trades } });
        refreshViews().catch(() => {});
      }
      lastBlock = latest;
      update({ block: latest, chain: 'online', chainError: null });
    }
  } catch (err) {
    update({ chain: 'offline', chainError: err.shortMessage || err.message });
  } finally {
    polling = false;
  }
}

// ----------------------------------------------------------------- wallet
const hexChain = '0x' + CHAIN.chainId.toString(16);
let walletId = null; // EIP-6963 rdns of the wallet the user picked (MetaMask, Coinbase Wallet...)
let eth = null; // its EIP-1193 provider

/** Which browser wallet to use for transactions (set from the session). */
export function useWallet(rdns) { walletId = rdns || null; eth = null; }
const injected = () => eth || providerFor(walletId);

export const hasWallet = () => typeof window !== 'undefined' && !!injected();

/** Ask the wallet for an account (shows the wallet popup), then switch it to the right network. */
export async function connectWallet(rdns = walletId) {
  if (rdns !== walletId) useWallet(rdns);
  const p = injected();
  if (!p) throw new Error('No browser wallet found. Install MetaMask or Coinbase Wallet (testnet account only).');
  eth = p;
  const [address] = await p.request({ method: 'eth_requestAccounts' });
  await ensureChain();
  update({ wallet: { address: ethers.getAddress(address), chainOk: true } });
  p.on?.('accountsChanged', (acc) => update({ wallet: acc[0] ? { address: ethers.getAddress(acc[0]), chainOk: true } : null }));
  refreshViews().catch(() => {});
  return ethers.getAddress(address);
}

/** Reconnect silently after a reload if the wallet already trusts this site (no popup). */
export async function resumeWallet(rdns) {
  useWallet(rdns);
  const p = injected();
  if (!p) return null;
  try {
    const [address] = await p.request({ method: 'eth_accounts' });
    if (!address) return null;
    eth = p;
    update({ wallet: { address: ethers.getAddress(address), chainOk: true } });
    p.on?.('accountsChanged', (acc) => update({ wallet: acc[0] ? { address: ethers.getAddress(acc[0]), chainOk: true } : null }));
    refreshViews().catch(() => {});
    return address;
  } catch { return null; }
}

export function disconnectWallet() { eth = null; update({ wallet: null }); }

async function ensureChain() {
  const p = injected();
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain }] });
  } catch (err) {
    if (err.code !== 4902 || CHAIN.chainId !== 84532) throw err;
    await p.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: hexChain, chainName: 'Base Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: [CHAIN.rpcUrl], blockExplorerUrls: [CHAIN.explorer] }] });
  }
}

async function send(method, ...args) {
  if (!state.wallet) await connectWallet();
  await ensureChain();
  const signer = await new ethers.BrowserProvider(injected()).getSigner();
  try {
    const tx = await escrow.connect(signer)[method](...args);
    const receipt = await tx.wait();
    await refreshViews().catch(() => {});
    poll();
    return receipt.hash;
  } catch (err) {
    throw new Error(explain(err));
  }
}

export function explain(err) {
  if (err?.code === 'ACTION_REJECTED' || err?.code === 4001 || err?.error?.code === 4001) return 'You cancelled the request in the wallet.';
  if (err?.code === -32002 || err?.error?.code === -32002) return 'Your wallet already has a request waiting: open the MetaMask extension and answer it.';
  const name = err?.revert?.name || (() => { try { return iface.parseError(err?.data)?.name; } catch { return null; } })();
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
  if (name) return `The contract refused: ${name}.`;
  return err?.shortMessage || err?.message || 'The transaction failed.';
}

export const tx = {
  withdraw: () => send('withdraw'),
  registerMeter: (meter) => send('registerMeter', ethers.getAddress(meter)),
  resolveDispute: (id, acceptedWh) => send('resolveDispute', BigInt(id), BigInt(acceptedWh)),
  refundExpired: (id) => send('refundExpired', BigInt(id)),
};

export const isAddress = (a) => ethers.isAddress(a);
export const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
