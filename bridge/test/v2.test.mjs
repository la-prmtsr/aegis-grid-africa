// Unit tests for the v2 meter logic (no MQTT, no chain). Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { MeterAGateway, MeterBSim, settlementDecision } from '../src/v2/meters.js';
import { domainFor, signReading, recoverSigner, structOf } from '../src/v2/signing.js';

const SIM = { timeScale: 60, lineLoss: 0.02, tamperFactor: 0.6, maxGapS: 5, minSocPct: 5, toleranceBps: 300 };

// A Stage 4E message as Faras's Wokwi sends it.
const wokwi = (o = {}) => {
  const m = {
    site: 'ag-sakarya26', meter_id: 'METER_A', pv_power_w: 0, pv_delivered_to_microgrid_w: 0,
    local_load_w: 300, buyer_request: true, buyer_demand_w: 250, total_demand_w: 550,
    battery_charge_w: 0, battery_discharge_w: 250, battery_energy_wh: 600, battery_soc_pct: 60,
    grid_import_w: 0, unserved_power_w: 300, grid_status: 'OUTAGE', emergency_backup_allowed: false,
    battery_min_soc_pct: 5, energy_status: 'EMERGENCY_SUPPLY_OK', ...o,
  };
  m.total_demand_w = m.local_load_w + m.buyer_demand_w;
  return m;
};

/** Feed n messages at 1 s spacing through Meter A and Meter B; returns both finals. */
function runTrade({ n = 60, tamper = false, maxWh = 500, msg = () => wokwi(), dropB = new Set(), dupB = false } = {}) {
  const a = new MeterAGateway({ sim: SIM, epoch: 1 });
  const b = new MeterBSim({ sim: SIM });
  b.tamper = tamper;
  let t = 0;
  const feed = (raw) => {
    const out = a.onWokwi(raw, (t += 1000));
    if (!dropB.has(out.telemetry.seq)) {
      const r = b.onSellerTelemetry(out.telemetry);
      if (dupB) b.onSellerTelemetry(out.telemetry); // QoS 1 redelivery
      if (r.final) return { out, bFinal: r.final };
    }
    return { out };
  };
  feed(msg(0)); // before the trade
  b.start({ tradeId: 7, maxWh });
  a.start({ tradeId: 7, maxWh });
  let sellerFinal = null;
  for (let i = 1; i <= n && !sellerFinal; i++) sellerFinal = feed(msg(i)).out.final;
  if (!sellerFinal) sellerFinal = a.stop('stop_cmd');
  let buyerFinal = b.stop({ tradeId: 7, untilSeq: sellerFinal.lastSeq });
  // the last seller message may still be on its way to Meter B
  for (let i = 0; i < 3 && !buyerFinal; i++) buyerFinal = feed(msg(n + i)).bFinal ?? null;
  return { a, b, sellerFinal, buyerFinal: buyerFinal ?? b.forceStop() };
}

const decide = (s, b, extra = {}) =>
  settlementDecision({ seller: s, buyer: b, sellerSigOk: true, buyerSigOk: true, approvals: { seller: true, buyer: true }, maxWh: 500, toleranceBps: 300, minSocBps: 500, ...extra });

test('honest trade: buyer reads 98% of seller, settles', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade();
  // 59 counted intervals x 1 s x 60 = 59 simulated minutes at 250 W
  assert.equal(s.wh, Math.floor((250 * 59) / 60)); // whole Wh, never rounded up
  assert.ok(Math.abs(b.whExact - s.whExact * 0.98) < 1e-9, `${b.whExact} vs ${s.whExact}`);
  assert.equal(decide(s, b).expected, 'SETTLED');
});

test('rounding guard: exact readings agree but whole Wh would not -> hold, not a false dispute', () => {
  // seen in the e2e run: 62.5875 vs 61.33575 Wh is a 2.0% gap; rounding to 63 vs 61 would read as 3.17%
  const s = { tradeId: 7, role: 'seller', wh: 63, whExact: 62.5875, socBpsAfter: 6000, issues: [] };
  const b = { tradeId: 7, role: 'buyer', wh: 61, whExact: 61.33575 };
  const d = decide(s, b);
  assert.equal(d.action, 'hold');
  assert.match(d.reason, /whole Wh/);
});

test('tampered buyer meter: readings disagree, submitted so the contract freezes the deposit', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade({ tamper: true });
  assert.ok(b.wh < s.wh * 0.9);
  const d = decide(s, b);
  assert.equal(d.action, 'submit');
  assert.equal(d.expected, 'DISPUTED');
});

test('no P2P energy while the grid is available (trade waits for the outage)', () => {
  const { a, sellerFinal: s } = runTrade({ msg: () => wokwi({ grid_status: 'AVAILABLE', battery_discharge_w: 0, unserved_power_w: 0, pv_power_w: 900, pv_delivered_to_microgrid_w: 550 }) });
  assert.equal(s.wh, 0);
  assert.equal(decide(s, s).action, 'hold');
  assert.equal(a.status({ grid: 'AVAILABLE', socPct: 60, chargeW: 0 }, 0, 0), 'IDLE_GRID');
});

test('buyer first: the shop is served before community load without emergency backup', () => {
  const a = new MeterAGateway({ sim: SIM });
  const { telemetry } = a.onWokwi(wokwi(), 0);
  assert.equal(telemetry.exportW, 250);
  assert.equal(telemetry.dischargeLocalW, 0);
});

test('trade cap: seller stops at maxWh and buyer never exceeds seller', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade({ n: 200, maxWh: 120 });
  assert.equal(s.reason, 'max_reached');
  assert.equal(s.wh, 120);
  assert.ok(b.wh <= s.wh);
  assert.equal(decide(s, b, { maxWh: 120 }).expected, 'SETTLED');
});

test('battery reserve: the trade ends at the 5% floor and the reading passes the contract check', () => {
  let soc = 6;
  const msg = (i) => {
    soc = Math.max(5, 6 - i * 0.05);
    const empty = soc <= 5;
    return wokwi({ battery_soc_pct: soc, battery_energy_wh: soc * 10, battery_discharge_w: empty ? 0 : 250, unserved_power_w: empty ? 550 : 300 });
  };
  const { sellerFinal: s, buyerFinal: b } = runTrade({ n: 100, msg });
  assert.equal(s.reason, 'soc_floor');
  assert.ok(s.socBpsAfter >= 500);
  assert.equal(decide(s, b).expected, 'SETTLED');
});

test('PCC isolation violation during the trade blocks settlement (not settlement evidence)', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade({ msg: (i) => wokwi(i === 10 ? { battery_charge_w: 100 } : {}) });
  assert.ok(s.issues.includes('PCC isolation violation'));
  const d = decide(s, b);
  assert.equal(d.action, 'hold');
  assert.match(d.reason, /PCC isolation/);
});

test('telemetry gap: both meters skip the same interval and still agree', () => {
  const a = new MeterAGateway({ sim: SIM, epoch: 1 });
  const b = new MeterBSim({ sim: SIM });
  const times = [0, 1000, 2000, 3000, 13000, 14000, 15000];
  b.start({ tradeId: 1, maxWh: 500 });
  a.start({ tradeId: 1, maxWh: 500 });
  for (const t of times) b.onSellerTelemetry(a.onWokwi(wokwi(), t).telemetry);
  const s = a.stop();
  const f = b.stop({ tradeId: 1, untilSeq: s.lastSeq });
  assert.equal(s.gaps, 1);
  assert.ok(Math.abs(f.whExact - s.whExact * 0.98) < 1e-9);
});

test('duplicate deliveries (QoS 1) are not counted twice', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade({ dupB: true });
  assert.ok(Math.abs(b.whExact - s.whExact * 0.98) < 1e-9);
});

test('buyer meter misses the last seller message: closes as incomplete, settlement held', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade({ n: 30, dropB: new Set([31, 32, 33, 34]) });
  assert.equal(b.incomplete, true);
  assert.equal(decide(s, b).action, 'hold');
});

test('approvals and zero energy are enforced', () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade();
  assert.equal(decide(s, b, { approvals: { seller: false, buyer: true } }).action, 'hold');
  assert.equal(decide({ ...s, wh: 0 }, b).action, 'hold');
  assert.equal(decide({ ...s, socBpsAfter: 499 }, b).action, 'hold');
});

test('each meter signs with its own key; a reading signed by the wrong key is rejected', async () => {
  const { sellerFinal: s, buyerFinal: b } = runTrade();
  const escrow = ethers.Wallet.createRandom().address;
  const domain = domainFor(84532, escrow);
  const sellerKey = ethers.Wallet.createRandom();
  const buyerKey = ethers.Wallet.createRandom();
  const ss = await signReading(sellerKey, domain, s, 1_790_000_000);
  const bs = await signReading(buyerKey, domain, b, 1_790_000_000);
  assert.equal(recoverSigner(domain, ss), sellerKey.address);
  assert.equal(recoverSigner(domain, bs), buyerKey.address);
  assert.deepEqual(Object.keys(structOf(ss)), ['tradeId', 'meter', 'wh', 'socBpsAfter', 'timestamp']);
  const forged = await signReading(ethers.Wallet.createRandom(), domain, { ...b, wh: b.wh + 50 }, 1_790_000_000);
  assert.notEqual(recoverSigner(domain, { ...forged, meter: buyerKey.address }), buyerKey.address);
  // a signature for another contract does not verify here
  const other = await signReading(buyerKey, domainFor(84532, ethers.Wallet.createRandom().address), b, 1_790_000_000);
  assert.notEqual(recoverSigner(domain, other), buyerKey.address);
});

test('time-scale estimator recognises an accelerated battery model', () => {
  const a = new MeterAGateway({ sim: SIM });
  let wh = 500;
  for (let i = 0; i < 20; i++) {
    // battery discharging 250 W while time runs 60x faster: 250/0.95 W x 60 s / 3600 per real second
    a.onWokwi(wokwi({ battery_energy_wh: wh, battery_soc_pct: wh / 10 }), i * 1000);
    wh -= (250 / 0.95) * 60 / 3600;
  }
  assert.ok(Math.abs(a.timeScaleEstimate() - 60) < 1, String(a.timeScaleEstimate()));
});

// ------------------------------------------------------------------ Control room additions
import { controlMessage } from '../src/v2/control.js';

test('Wokwi control: switches use ON/OFF payloads, setpoints fill {value} in watts', () => {
  const sw = { topic: 'grid', on: '{"grid_status":"OUTAGE"}', off: '{"grid_status":"AVAILABLE"}', value: '' };
  assert.deepEqual(controlMessage(sw, true), { sub: 'grid', payload: '{"grid_status":"OUTAGE"}' });
  assert.deepEqual(controlMessage(sw, false), { sub: 'grid', payload: '{"grid_status":"AVAILABLE"}' });
  const pv = { topic: 'pv', on: '', off: '', value: '{"pv_power_w":{value}}' };
  assert.deepEqual(controlMessage(pv, 649.6), { sub: 'pv', payload: '{"pv_power_w":650}' });
  assert.equal(controlMessage(pv, -5), null);
  assert.equal(controlMessage(pv, true), null); // a setpoint is not a switch
  assert.equal(controlMessage({ topic: '', on: 'x', off: 'y', value: '' }, true), null); // not configured
});

test('Meter A reports which simulator produced the data and the total demand', () => {
  const a = new MeterAGateway({ sim: SIM });
  assert.equal(a.onWokwi(wokwi(), 0).telemetry.source, 'wokwi');
  const m = a.onWokwi({ ...wokwi(), sim_source: 'MOCK' }, 1000).telemetry;
  assert.equal(m.source, 'mock');
  assert.equal(m.totalDemandW, 550);
});
