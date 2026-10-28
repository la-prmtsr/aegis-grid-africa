// Relayer: Buyer Request (app or the Wokwi/Unity button) -> openTrade -> both meters measure ->
// both meters sign -> verify -> settleTrade on Base Sepolia. Holds the relayer key (gas) and the
// shop's demo wallet (deposit), never a meter key.
import { SIM, TRADE, WOKWI_CONTROL, EXPLORER, topics, chain } from './config.js';
import { connect, logger } from './mqtt.js';
import { connectChain, STATUS } from './chain.js';
import { recoverSigner } from './signing.js';
import { settlementDecision } from './meters.js';

const log = logger('relayer');
const c = await connectChain();
const link = (hash) => (c.chainId === 84532n ? `${EXPLORER}/tx/${hash}` : hash);
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

log(`chain ${c.chainId}, escrow ${chain.escrow}, contract battery reserve ${c.minSocBps / 100}%`);
if (c.minSocBps !== Math.round(SIM.minSocPct * 100)) {
  log(`WARNING: contract reserve ${c.minSocBps / 100}% differs from AEGIS_MIN_SOC_PCT ${SIM.minSocPct}%. Use the v2 contract (docs/integration-v2.md).`);
}

const S = {
  grid: null,
  wokwiRequest: false,
  appRequest: false,
  busy: false,
  needRelease: false, // after a trade ends, the request must be released before a new one opens
  active: null, // { id, source, openTx, sellerMeter, buyerMeter, approvals, stopping, seller, buyer, timer }
  lastResult: null,
  notice: null,
};

async function sellerApproved() {
  // Resident A's consent = a meter registered on-chain by the seller's own wallet (an explicit, signed act),
  // plus the standing permission in .env (SELLER_CONSENT, default true).
  if ((process.env.SELLER_CONSENT ?? 'true') !== 'true') return false;
  const meter = await c.escrow.meterOf(chain.sellerAddress);
  return meter !== '0x0000000000000000000000000000000000000000';
}

const { publish } = connect('relayer', [topics.telemetry('METER_A'), topics.appRequest, topics.appDemo, topics.readingAll], async (topic, msg) => {
  if (topic === topics.telemetry('METER_A')) {
    S.grid = msg.grid;
    S.wokwiRequest = Boolean(msg.buyerRequest);
    return evaluate();
  }
  if (topic === topics.appRequest && typeof msg.requesting === 'boolean') {
    log(`app: shop ${msg.requesting ? 'requests clean power' : 'stops'}`);
    S.appRequest = msg.requesting;
    if (!msg.requesting) wokwiControl('buyer', false);
    return evaluate();
  }
  if (topic === topics.appDemo) {
    if (typeof msg.outage === 'boolean') wokwiControl('outage', msg.outage);
    if (typeof msg.backup === 'boolean') wokwiControl('backup', msg.backup);
    return;
  }
  const m = topic.match(/trade\/(\d+)\/reading\/(seller|buyer)$/);
  if (m) return onReading(Number(m[1]), m[2], msg);
}, log);

function wokwiControl(kind, on) {
  const ctl = WOKWI_CONTROL[kind];
  if (!ctl.topic) {
    log(`(Wokwi control "${kind}" not configured, would set it ${on ? 'ON' : 'OFF'})`);
    return false;
  }
  publish(topics.wokwiControl(ctl.topic), on ? ctl.on : ctl.off);
  log(`Wokwi control ${kind} -> ${on ? 'ON' : 'OFF'}`);
  return true;
}

async function evaluate() {
  const requested = S.appRequest || S.wokwiRequest;
  if (!requested) S.needRelease = false;

  if (!S.active && !S.busy && requested && !S.needRelease && S.grid === 'OUTAGE') return open();
  if (S.active && !S.active.stopping && (!requested || S.grid !== 'OUTAGE')) {
    return stop(S.grid !== 'OUTAGE' ? 'grid restored' : 'shop stopped requesting');
  }
}

async function open() {
  S.busy = true;
  const source = S.appRequest ? 'app' : 'wokwi-button';
  try {
    if (!(await sellerApproved())) {
      S.notice = 'Seller has not approved (no registered meter or SELLER_CONSENT=false)';
      S.needRelease = true;
      log(S.notice);
      return;
    }
    log(`buyer request (${source}) during outage -> openTrade, deposit ${TRADE.maxWh} Wh ...`);
    const { id, txHash } = await c.openTrade();
    const t = await c.tradeInfo(id, 'None');
    S.active = {
      id, source, openTx: txHash, sellerMeter: t.sellerMeter, buyerMeter: t.buyerMeter,
      approvals: { buyer: true, seller: true }, stopping: false, seller: null, buyer: null, timer: null,
    };
    S.notice = null;
    log(`trade ${id} OPENED ${link(txHash)}`);
    // Meter B first, so it never misses an interval Meter A counts.
    await publish(topics.cmd('METER_B'), { cmd: 'start', tradeId: id, maxWh: Number(TRADE.maxWh) });
    await publish(topics.cmd('METER_A'), { cmd: 'start', tradeId: id, maxWh: Number(TRADE.maxWh) });
    if (source === 'app' && !wokwiControl('buyer', true)) {
      S.notice = 'Wokwi buyer control is not configured: press the buyer request button in Wokwi/Unity so power flows';
    }
  } catch (err) {
    // never retry automatically: a retry loop could open several deposits
    S.needRelease = true;
    S.notice = `openTrade failed: ${err.shortMessage ?? err.message}. Release and press the request again.`;
    log(S.notice);
  } finally {
    S.busy = false;
    await publishStatus();
  }
  return evaluate(); // the request may have been released meanwhile
}

async function stop(why) {
  const a = S.active;
  a.stopping = true;
  log(`trade ${a.id}: ${why} -> stop Meter A`);
  await publish(topics.cmd('METER_A'), { cmd: 'stop', tradeId: a.id });
  clearTimeout(a.timer);
  a.timer = setTimeout(() => {
    if (S.active === a && !(a.seller && a.buyer)) close(a, { outcome: 'HELD', reason: 'A final reading did not arrive within 15 s' });
  }, 15000);
  await publishStatus();
}

async function onReading(id, role, reading) {
  const a = S.active;
  if (!a || a.id !== id || a[role]) return; // old retained reading or duplicate
  a[role] = reading;
  log(`trade ${id}: ${role} meter signed ${reading.wh} Wh${reading.reason ? ` (${reading.reason})` : ''}`);
  if (role === 'seller') {
    if (!a.stopping) {
      a.stopping = true; // the gateway ended the trade itself (cap or battery reserve)
      if (a.source === 'app') wokwiControl('buyer', false);
    }
    await publish(topics.cmd('METER_B'), { cmd: 'stop', tradeId: id, untilSeq: reading.lastSeq });
  }
  if (a.seller && a.buyer) await finish(a);
  else await publishStatus();
}

async function finish(a) {
  const valid = (r, meter) => same(recoverSigner(c.domain, r), meter) && same(r.meter, meter) && same(r.escrow, chain.escrow);
  const decision = settlementDecision({
    seller: a.seller,
    buyer: a.buyer,
    sellerSigOk: valid(a.seller, a.sellerMeter),
    buyerSigOk: valid(a.buyer, a.buyerMeter),
    approvals: a.approvals,
    maxWh: Number(TRADE.maxWh),
    toleranceBps: SIM.toleranceBps,
    minSocBps: c.minSocBps,
  });
  if (decision.action === 'hold') return close(a, { outcome: 'HELD', reason: decision.reason });

  S.busy = true;
  try {
    log(`trade ${a.id}: signatures verified, ${decision.reason.toLowerCase()} -> settleTrade ...`);
    const r = await c.settle(a.id, a.seller, a.buyer);
    const t = await c.tradeInfo(a.id, 'Open');
    log(`trade ${a.id} ${r.outcome}${r.outcome === 'SETTLED' ? `: paid for ${r.deliveredWh} Wh` : r.outcome === 'DISPUTED' ? `: ${r.sellerWh} vs ${r.buyerWh} Wh, deposit frozen` : ''} ${link(r.txHash)} (on-chain: ${STATUS[Number(t.status)]})`);
    await close(a, { ...r, reason: decision.reason });
  } catch (err) {
    await close(a, { outcome: 'FAILED', reason: err.shortMessage ?? err.message });
  } finally {
    S.busy = false;
  }
}

async function close(a, result) {
  clearTimeout(a.timer);
  if (S.active !== a) return;
  S.active = null;
  S.needRelease = S.appRequest || S.wokwiRequest;
  S.lastResult = { id: a.id, sellerWh: a.seller?.wh ?? null, buyerWh: a.buyer?.wh ?? null, tamper: a.buyer?.tamper ?? null, ...result };
  if (result.outcome === 'HELD' || result.outcome === 'FAILED') {
    log(`trade ${a.id} ${result.outcome}: ${result.reason}. The deposit stays in escrow; refundExpired returns it after expiry.`);
  }
  await publishStatus();
}

async function publishStatus() {
  const a = S.active;
  await publish(topics.backendStatus, {
    v: 2,
    updatedAt: Date.now(),
    chainId: Number(c.chainId),
    escrow: chain.escrow,
    grid: S.grid,
    requests: { app: S.appRequest, wokwi: S.wokwiRequest },
    active: a ? { id: a.id, source: a.source, openTx: a.openTx, approvals: a.approvals, stopping: a.stopping, sellerWh: a.seller?.wh ?? null, buyerWh: a.buyer?.wh ?? null } : null,
    lastResult: S.lastResult,
    notice: S.notice,
    wokwiControl: Object.fromEntries(Object.entries(WOKWI_CONTROL).map(([k, v]) => [k, Boolean(v.topic)])),
    params: { timeScale: SIM.timeScale, lineLoss: SIM.lineLoss, minSocPct: c.minSocBps / 100, toleranceBps: SIM.toleranceBps, maxWh: Number(TRADE.maxWh) },
  }, { retain: true });
}

setInterval(publishStatus, 10000);
await publishStatus();
log('waiting for a buyer request (app/request or the Wokwi buyer button) during an outage');
