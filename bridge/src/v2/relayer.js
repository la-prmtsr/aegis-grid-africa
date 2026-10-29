// Relayer: Buyer Request -> openTrade -> both meters measure -> verify -> (testnet only) settleTrade.
// Holds the relayer key (gas) and the shop's demo wallet (deposit), never a meter key.
//
// Evidence (AEGIS_EVIDENCE):
//   wokwi-final (default, Stage 5B.3): Faras's METER_A/METER_B firmware. The escrow id from TradeOpened is
//     the tradeId of the firmware START/STOP command; the two unsigned final events are validated, stored
//     and checked twice (fractional Wh, then whole Wh as sent to the contract).
//   gateway: the v2 gateways count the energy from Stage 4E telemetry and sign it (older firmware).
// Settlement (SETTLEMENT_MODE): off (default) = verify only, nothing on-chain after openTrade;
//   testnet = Base Sepolia demo with test funds, labelled SIMULATED_TESTNET_SETTLEMENT.
import { SITE, SIM, TRADE, STAGE5B, WOKWI_CONTROL, EXPLORER, topics, chain } from './config.js';
import { connect, logger } from './mqtt.js';
import { connectChain, STATUS } from './chain.js';
import { recoverSigner } from './signing.js';
import { settlementDecision } from './meters.js';
import { controlMessage } from './control.js';
import { STATUS as T, LABEL_TESTNET, validateFinal, verifyPair, chainIdOf, dedupeKey, toContractWh } from './evidence.js';
import { openEvidenceStore } from './evidence-store.js';
import { startStatusApi } from './status-api.js';

const log = logger('relayer');
const c = await connectChain();
const link = (hash) => (c.chainId === 84532n ? `${EXPLORER}/tx/${hash}` : hash);
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
const FIVE_B = STAGE5B.evidence === 'wokwi-final';
const TESTNET = STAGE5B.settlementMode === 'testnet';
const tamperAvailable = !FIVE_B || process.env.AEGIS_MOCK === '1'; // real 5B.2 firmware: tamper is set in Wokwi

log(`chain ${c.chainId}, escrow ${chain.escrow}, contract battery reserve ${c.minSocBps / 100}%`);
log(`evidence: ${STAGE5B.evidence}, settlement: ${STAGE5B.settlementMode}${TESTNET ? ` (${LABEL_TESTNET}, minimum ${STAGE5B.minSettleWh} Wh)` : ' (verify only, no settleTrade)'}`);
if (c.minSocBps !== Math.round(SIM.minSocPct * 100)) {
  log(`WARNING: contract reserve ${c.minSocBps / 100}% differs from AEGIS_MIN_SOC_PCT ${SIM.minSocPct}%. Use the v2 contract (docs/integration-v2.md).`);
}

const store = openEvidenceStore(STAGE5B.evidenceDir, `evidence-${c.chainId}-${chain.escrow.toLowerCase()}`);
log(`evidence store: ${store.file}`);

const S = {
  grid: null,
  wokwiRequest: false,
  appRequest: false,
  busy: false,
  needRelease: false, // after a trade ends, the request must be released before a new one opens
  active: null, // the trade in progress (both flows)
  lastResult: null,
  notice: null,
  meterBSeen: 0, // last raw METER_B firmware telemetry (Stage 5B.2)
  lastTradeEnd: 0, // the firmware may still report the buyer request for a moment after STOP
};
const trades = new Map(); // escrow id -> Stage 5B record (newest kept, see summary())

/** Rebuild trade records from the evidence store, so verdicts survive a backend restart. */
function restoreTrades() {
  const blank = (id) => ({ id, tradeId: String(id), source: 'app', status: null, finals: { seller: null, buyer: null }, signed: { seller: null, buyer: null }, verify: null, label: null, settlementMode: null, stopping: true, timer: null });
  for (const e of store.past()) {
    if (e.kind === 'status' && Number.isInteger(e.tradeId)) {
      const rec = trades.get(e.tradeId) ?? blank(e.tradeId);
      const { receivedAt, kind, tradeId, status, check, ...detail } = e;
      Object.assign(rec, detail, { status, updatedAt: Date.parse(receivedAt) });
      if (check) rec.verify = check;
      trades.set(e.tradeId, rec);
    } else if (e.kind === 'final' && e.accepted) {
      const id = chainIdOf(e.tradeId);
      const v = validateFinal(e.payload, { site: SITE, topicMeterId: e.payload?.meterId });
      if (id !== null && v.ok && trades.has(id)) trades.get(id).finals[v.final.role] = v.final;
    }
  }
  for (const rec of trades.values()) {
    if (![T.SIMULATION_VERIFIED, T.REJECTED, T.SETTLED, T.DISPUTED, T.FAILED].includes(rec.status)) {
      setStatus(rec, T.REJECTED, { reason: `backend restarted while the trade was ${rec.status}` });
    }
  }
  if (trades.size) log(`restored ${trades.size} trade record(s) from the evidence store`);
}
if (FIVE_B) restoreTrades();

async function sellerApproved() {
  // Resident A's consent = a meter registered on-chain by the seller's own wallet (an explicit, signed act),
  // plus the standing permission in .env (SELLER_CONSENT, default true).
  if ((process.env.SELLER_CONSENT ?? 'true') !== 'true') return false;
  const meter = await c.escrow.meterOf(chain.sellerAddress);
  return meter !== '0x0000000000000000000000000000000000000000';
}

// Subscribe to the evidence topics BEFORE any command can be sent (Faras's checklist, step 1).
const subs = [topics.telemetry('METER_A'), topics.telemetry('METER_B'), topics.appRequest, topics.appDemo, topics.readingAll, topics.finalAll];
const { publish } = connect('relayer', subs, async (topic, msg) => {
  if (topic === topics.telemetry('METER_A')) {
    S.grid = msg.grid;
    const req = Boolean(msg.buyerRequest);
    const changed = req !== S.wokwiRequest;
    S.wokwiRequest = req;
    if (changed && FIVE_B) await publishStatus(); // keeps the "button pressed in Unity" notice current
    return evaluate();
  }
  if (topic === topics.telemetry('METER_B')) {
    if (msg.v !== 2) S.meterBSeen = Date.now(); // v2 = our dashboard view; anything else = METER_B firmware
    return undefined;
  }
  if (topic === topics.appRequest && typeof msg.requesting === 'boolean') {
    log(`app: shop ${msg.requesting ? 'requests clean power' : 'stops'}`);
    S.appRequest = msg.requesting;
    if (!msg.requesting && !FIVE_B) wokwiControl('buyer', false);
    return evaluate();
  }
  if (topic === topics.appDemo) {
    if (typeof msg.outage === 'boolean') wokwiControl('outage', msg.outage);
    if (typeof msg.backup === 'boolean') wokwiControl('backup', msg.backup);
    if (Number.isFinite(msg.pvW)) wokwiControl('pv', msg.pvW);
    if (Number.isFinite(msg.communityLoadW)) wokwiControl('load', msg.communityLoadW);
    return undefined;
  }
  const f = topic.match(/\/meter\/([^/]+)\/final$/);
  if (f) return onFinal(topic, f[1], msg);
  const m = topic.match(/trade\/(\d+)\/reading\/(seller|buyer)$/);
  if (m) return onReading(Number(m[1]), m[2], msg);
  return undefined;
}, log);

/** Send one command to Wokwi: a switch (true/false) or a setpoint in watts. */
function wokwiControl(kind, input) {
  const label = typeof input === 'boolean' ? (input ? 'ON' : 'OFF') : `${Math.round(input)} W`;
  const m = controlMessage(WOKWI_CONTROL[kind], input);
  if (!m) {
    log(`(Wokwi control "${kind}" not configured, would set it ${label})`);
    return false;
  }
  publish(topics.wokwiControl(m.sub), m.payload);
  log(`Wokwi control ${kind} -> ${label}`);
  return true;
}

async function evaluate() {
  // Stage 5B: only the app may start a trade. The firmware needs the escrow id, which exists only after
  // openTrade; a buyer button pressed in Unity/Wokwi cannot create one.
  const requested = FIVE_B ? S.appRequest : S.appRequest || S.wokwiRequest;
  if (!requested) S.needRelease = false;

  if (!S.active && !S.busy && requested && !S.needRelease && S.grid === 'OUTAGE') return FIVE_B ? open5b() : open();
  if (S.active && !S.active.stopping && (!requested || S.grid !== 'OUTAGE')) {
    const why = S.grid !== 'OUTAGE' ? 'grid restored' : 'shop stopped requesting';
    return FIVE_B ? stop5b(S.active, why) : stop(why);
  }
  return undefined;
}

// ================================================================== Stage 5B.3 (wokwi-final)
function setStatus(rec, status, detail = {}) {
  rec.status = status;
  rec.updatedAt = Date.now();
  Object.assign(rec, detail);
  store.status(rec.id, status, detail);
  log(`trade ${rec.id}: ${status}${detail.reason ? ` (${detail.reason})` : ''}`);
}

/** Every command to the firmware or a gateway is stored as evidence before it is sent. */
async function command(topic, payload) {
  store.command(topic, payload);
  await publish(topic, payload);
}

async function open5b() {
  S.busy = true;
  let rec = null;
  try {
    if (!(await sellerApproved())) {
      S.notice = 'Seller has not approved (no registered meter or SELLER_CONSENT=false)';
      S.needRelease = true;
      log(S.notice);
      return undefined;
    }
    log(`buyer request (app) during outage -> openTrade, deposit ${TRADE.maxWh} Wh ...`);
    const { id, txHash } = await c.openTrade();
    const t = await c.tradeInfo(id, 'None');
    rec = {
      id, tradeId: String(id), source: 'app', openTx: txHash, openedAt: Date.now(), status: null,
      sellerMeter: t.sellerMeter, buyerMeter: t.buyerMeter, approvals: { buyer: true, seller: true },
      stopping: false, finals: { seller: null, buyer: null }, signed: { seller: null, buyer: null },
      verify: null, label: null, settlementMode: STAGE5B.settlementMode, timer: null, // label set only when a testnet tx is sent
    };
    trades.set(id, rec);
    S.active = rec;
    S.notice = null;
    setStatus(rec, T.PENDING, { openTx: txHash });
    log(`trade ${id} OPENED ${link(txHash)}`);
    // REMOTE mode first, then START with the escrow id. Never a hand-typed test id.
    await command(topics.wokwiControl(STAGE5B.modeTopic), STAGE5B.modeRemote);
    await command(topics.tradeCmd, { op: 'start', tradeId: rec.tradeId, targetW: STAGE5B.targetW });
    setStatus(rec, T.ACTIVE, { targetW: STAGE5B.targetW });
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

async function stop5b(rec, why) {
  rec.stopping = true;
  log(`trade ${rec.id}: ${why} -> STOP`);
  await command(topics.tradeCmd, { op: 'stop', tradeId: rec.tradeId });
  if (rec.status === T.ACTIVE) setStatus(rec, T.STOPPED, { stopReason: why });
  armFinalTimeout(rec);
  await publishStatus();
}

function armFinalTimeout(rec) {
  clearTimeout(rec.timer);
  rec.timer = setTimeout(() => {
    if ([T.ACTIVE, T.STOPPED, T.AWAITING_EVIDENCE].includes(rec.status)) {
      const missing = ['seller', 'buyer'].filter((r) => !rec.finals[r]).map((r) => (r === 'seller' ? 'METER_A' : 'METER_B'));
      close5b(rec, T.REJECTED, { reason: `missing final from ${missing.join(' and ')} after ${STAGE5B.finalTimeoutS} s` });
    }
  }, STAGE5B.finalTimeoutS * 1000);
}

async function onFinal(topic, topicMeterId, payload) {
  const reject = (reason, extra = {}) => {
    store.final(topic, payload, { accepted: false, reason, ...extra });
    log(`rejected ${topicMeterId} final: ${reason}`);
  };
  if (!FIVE_B) return reject('AEGIS_EVIDENCE=gateway: firmware finals are not used');
  const v = validateFinal(payload, { site: SITE, topicMeterId });
  if (!v.ok) return reject(v.reason);
  const f = v.final;
  const key = dedupeKey(f);
  if (store.has(key)) return reject('duplicate or replayed final', { key, tradeId: f.tradeId });
  const id = chainIdOf(f.tradeId);
  if (id === null) return reject(`tradeId "${f.tradeId}" is not an escrow trade id (local test only)`, { key, tradeId: f.tradeId });
  const rec = trades.get(id);
  if (!rec || ![T.ACTIVE, T.STOPPED, T.AWAITING_EVIDENCE].includes(rec.status)) {
    return reject(rec ? `trade ${id} is already ${rec.status}` : `trade ${id} was not started by this backend`, { key, tradeId: f.tradeId });
  }
  store.final(topic, payload, { key, accepted: true, reason: 'stored', tradeId: f.tradeId });
  rec.finals[f.role] = f;
  log(`trade ${id}: ${f.meterId} final ${f.wh} Wh (${f.reason ?? 'no reason'})`);

  if (f.role === 'seller' && !rec.stopping) {
    // METER_A ended the trade itself (battery reserve, target reached): stop and wait for METER_B
    rec.stopping = true;
    S.needRelease = S.appRequest;
    setStatus(rec, T.STOPPED, { stopReason: `METER_A ${f.reason ?? 'stopped'}` });
    armFinalTimeout(rec);
  }
  if (rec.finals.seller && rec.finals.buyer) return verify5b(rec);
  setStatus(rec, T.AWAITING_EVIDENCE);
  return publishStatus();
}

async function verify5b(rec) {
  clearTimeout(rec.timer);
  const r = verifyPair(rec.finals.seller, rec.finals.buyer, {
    toleranceBps: SIM.toleranceBps,
    minSettleWh: TESTNET ? STAGE5B.minSettleWh : 0,
    maxWh: Number(TRADE.maxWh),
    minSocBps: c.minSocBps,
    integer: TESTNET,
  });
  rec.verify = r;
  if (!r.ok) return close5b(rec, T.REJECTED, { reason: `${r.stage} check: ${r.reason}` });
  if (!TESTNET) return close5b(rec, T.SIMULATION_VERIFIED, { reason: `${r.reason}; SETTLEMENT_MODE=off, nothing sent on-chain` });

  setStatus(rec, T.SIGNING, { reason: `${r.reason}: asking both gateways to sign` });
  await publishStatus();
  await command(topics.cmd('METER_A'), { cmd: 'sign', tradeId: rec.id });
  await command(topics.cmd('METER_B'), { cmd: 'sign', tradeId: rec.id });
  clearTimeout(rec.timer);
  rec.timer = setTimeout(() => {
    if (rec.status === T.SIGNING) close5b(rec, T.REJECTED, { reason: 'a gateway did not return its signed reading within 20 s' });
  }, 20000);
  return undefined;
}

/** Testnet only: both gateway readings must match the verified whole-Wh values before settleTrade. */
async function settle5b(rec) {
  clearTimeout(rec.timer);
  const { seller, buyer } = rec.signed;
  const sigOk = (r, meter) => same(recoverSigner(c.domain, r), meter) && same(r.meter, meter) && same(r.escrow, chain.escrow);
  const expect = rec.verify.int;
  const problems = [];
  if (!sigOk(seller, rec.sellerMeter)) problems.push('seller reading not signed by the registered seller meter');
  if (!sigOk(buyer, rec.buyerMeter)) problems.push('buyer reading not signed by the registered buyer meter');
  if (seller.wh !== expect.sellerWh || buyer.wh !== expect.buyerWh) problems.push('signed Wh differ from the verified whole-Wh values');
  if (seller.wh !== toContractWh(rec.finals.seller.wh) || buyer.wh !== toContractWh(rec.finals.buyer.wh)) problems.push('signed Wh differ from the meter finals');
  if (seller.socBpsAfter !== rec.finals.seller.socBpsAfter) problems.push('signed battery level differs from the METER_A final');
  if (problems.length) return close5b(rec, T.REJECTED, { reason: problems.join('; ') });

  S.busy = true;
  try {
    rec.label = LABEL_TESTNET;
    log(`trade ${rec.id}: ${LABEL_TESTNET} -> settleTrade (${seller.wh} vs ${buyer.wh} Wh) ...`);
    const r = await c.settle(rec.id, seller, buyer);
    const t = await c.tradeInfo(rec.id, 'Open');
    log(`trade ${rec.id} ${r.outcome} ${link(r.txHash)} (on-chain: ${STATUS[Number(t.status)]})`);
    const status = r.outcome === 'SETTLED' ? T.SETTLED : r.outcome === 'DISPUTED' ? T.DISPUTED : T.FAILED;
    await close5b(rec, status, { reason: `${LABEL_TESTNET}: ${r.outcome.toLowerCase()} on-chain`, settleTx: r.txHash, deliveredWh: r.deliveredWh ?? null });
  } catch (err) {
    await close5b(rec, T.FAILED, { reason: err.shortMessage ?? err.message });
  } finally {
    S.busy = false;
  }
  return undefined;
}

async function close5b(rec, status, detail) {
  clearTimeout(rec.timer);
  const v = rec.verify;
  setStatus(rec, status, { ...detail, label: rec.label, check: v ? { ok: v.ok, stage: v.stage, frac: v.frac, int: v.int ?? null } : null });
  if (S.active === rec) {
    S.active = null;
    S.needRelease = S.appRequest;
  }
  S.lastTradeEnd = Date.now();
  S.lastResult = { id: rec.id, outcome: status, reason: detail.reason, label: rec.label, sellerWh: rec.finals.seller?.wh ?? null, buyerWh: rec.finals.buyer?.wh ?? null };
  if (status === T.SIMULATION_VERIFIED || status === T.REJECTED) {
    log(`trade ${rec.id}: deposit stays in escrow; refundExpired returns it to the buyer after expiry`);
  }
  await publishStatus();
}

const summary = (rec) => ({
  id: rec.id,
  tradeId: rec.tradeId,
  status: rec.status,
  label: rec.label,
  settlementMode: rec.settlementMode,
  evidence: 'wokwi-final',
  reason: rec.reason ?? null,
  targetW: rec.targetW ?? null,
  openTx: rec.openTx,
  settleTx: rec.settleTx ?? null,
  finals: {
    seller: rec.finals.seller && { wh: rec.finals.seller.wh, socBpsAfter: rec.finals.seller.socBpsAfter, reason: rec.finals.seller.reason, simulated: rec.finals.seller.simulated },
    buyer: rec.finals.buyer && { wh: rec.finals.buyer.wh, tamper: rec.finals.buyer.tamper, reason: rec.finals.buyer.reason, simulated: rec.finals.buyer.simulated, independentPhysicalMeasurement: rec.finals.buyer.independentPhysicalMeasurement },
  },
  check: rec.verify ? { ok: rec.verify.ok, stage: rec.verify.stage, frac: rec.verify.frac, int: rec.verify.int ?? null } : null,
  openedAt: rec.openedAt ?? null,
  updatedAt: rec.updatedAt,
});
const recent = () => [...trades.values()].sort((a, b) => b.id - a.id).slice(0, 20).map(summary);

// ================================================================== gateway evidence (older firmware)
async function open() {
  S.busy = true;
  const source = S.appRequest ? 'app' : 'wokwi-button';
  try {
    if (!(await sellerApproved())) {
      S.notice = 'Seller has not approved (no registered meter or SELLER_CONSENT=false)';
      S.needRelease = true;
      log(S.notice);
      return undefined;
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
    S.needRelease = true;
    S.notice = `openTrade failed: ${err.shortMessage ?? err.message}. Release and press the request again.`;
    log(S.notice);
  } finally {
    S.busy = false;
    await publishStatus();
  }
  return evaluate();
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
  if (FIVE_B) {
    const rec = trades.get(id);
    if (!rec || rec.status !== T.SIGNING || rec.signed[role] || reading.source !== 'wokwi-final') return undefined;
    rec.signed[role] = reading;
    log(`trade ${id}: ${role} gateway signed ${reading.wh} Wh`);
    return rec.signed.seller && rec.signed.buyer ? settle5b(rec) : undefined;
  }
  const a = S.active;
  if (!a || a.id !== id || a[role]) return undefined; // old retained reading or duplicate
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
  return undefined;
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
  if (!TESTNET) return close(a, { outcome: 'VERIFIED', reason: `${decision.reason}; SETTLEMENT_MODE=off, nothing sent on-chain` });

  S.busy = true;
  try {
    log(`trade ${a.id}: signatures verified, ${decision.reason.toLowerCase()} -> settleTrade (${LABEL_TESTNET}) ...`);
    const r = await c.settle(a.id, a.seller, a.buyer);
    const t = await c.tradeInfo(a.id, 'Open');
    log(`trade ${a.id} ${r.outcome}${r.outcome === 'SETTLED' ? `: paid for ${r.deliveredWh} Wh` : r.outcome === 'DISPUTED' ? `: ${r.sellerWh} vs ${r.buyerWh} Wh, deposit frozen` : ''} ${link(r.txHash)} (on-chain: ${STATUS[Number(t.status)]})`);
    await close(a, { ...r, reason: decision.reason, label: LABEL_TESTNET });
  } catch (err) {
    await close(a, { outcome: 'FAILED', reason: err.shortMessage ?? err.message });
  } finally {
    S.busy = false;
  }
  return undefined;
}

async function close(a, result) {
  clearTimeout(a.timer);
  if (S.active !== a) return;
  S.active = null;
  S.needRelease = S.appRequest || S.wokwiRequest;
  S.lastResult = { id: a.id, sellerWh: a.seller?.wh ?? null, buyerWh: a.buyer?.wh ?? null, tamper: a.buyer?.tamper ?? null, ...result };
  if (['HELD', 'FAILED', 'VERIFIED'].includes(result.outcome)) {
    log(`trade ${a.id} ${result.outcome}: ${result.reason}. The deposit stays in escrow; refundExpired returns it after expiry.`);
  }
  await publishStatus();
}

// ================================================================== status (MQTT + read-only HTTP)
async function publishStatus() {
  const a = S.active;
  await publish(topics.backendStatus, {
    v: 2,
    updatedAt: Date.now(),
    chainId: Number(c.chainId),
    escrow: chain.escrow,
    grid: S.grid,
    requests: { app: S.appRequest, wokwi: S.wokwiRequest },
    active: a ? { id: a.id, source: a.source, openTx: a.openTx, approvals: a.approvals, stopping: a.stopping, status: a.status ?? null, sellerWh: FIVE_B ? a.finals?.seller?.wh ?? null : a.seller?.wh ?? null, buyerWh: FIVE_B ? a.finals?.buyer?.wh ?? null : a.buyer?.wh ?? null } : null,
    lastResult: S.lastResult,
    notice: S.notice ?? (FIVE_B && S.wokwiRequest && !S.appRequest && !a && Date.now() - S.lastTradeEnd > 3000 ? 'Buyer button pressed in Wokwi/Unity: in Stage 5B trades start only from the app (the firmware needs the escrow id)' : null),
    wokwiControl: Object.fromEntries(Object.entries(WOKWI_CONTROL).map(([k, v]) => [k, Boolean(v.topic)])),
    stage5b: { evidence: STAGE5B.evidence, settlementMode: STAGE5B.settlementMode, label: TESTNET ? LABEL_TESTNET : null, minSettleWh: STAGE5B.minSettleWh, targetW: STAGE5B.targetW, meterBFirmwareSeen: S.meterBSeen || null },
    controls: { tamper: tamperAvailable },
    trades: FIVE_B ? recent() : [],
    params: { timeScale: SIM.timeScale, lineLoss: SIM.lineLoss, minSocPct: c.minSocBps / 100, toleranceBps: SIM.toleranceBps, maxWh: Number(TRADE.maxWh) },
  }, { retain: true });
}

startStatusApi({
  port: STAGE5B.statusPort,
  log,
  health: () => ({ ok: true, site: SITE, chainId: Number(c.chainId), escrow: chain.escrow, evidence: STAGE5B.evidence, settlementMode: STAGE5B.settlementMode, label: TESTNET ? LABEL_TESTNET : null, active: S.active?.id ?? null, trades: trades.size, evidenceFile: store.file }),
  trades: recent,
});

setInterval(publishStatus, 10000);
await publishStatus();
log(FIVE_B ? 'waiting for a buyer request from the app during an outage (Stage 5B: METER_A in REMOTE mode)' : 'waiting for a buyer request (app/request or the Wokwi buyer button) during an outage');
