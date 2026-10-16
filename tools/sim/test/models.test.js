import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SellerModel, BuyerModel } from '../models.js';

const agree = (s, b) => b <= s && (s - b) * 10000 <= s * 300; // contract rule, 3%
const DT = 1 / 3600; // one simulated second per step

function runTrade({ tamper = false, maxWh = 300, hours = 2 } = {}) {
  const s = new SellerModel({}, 0.8);
  const b = new BuyerModel();
  b.tamper = tamper;
  s.startTrade(1, maxWh, 250);
  b.startTrade(1);
  let stop = null;
  for (let i = 0; i < hours * 3600 && !stop; i++) {
    stop = s.step(0, 50, true, DT).stop;
    b.onLine(1, s.tradeWh);
    b.step(300, true, DT);
  }
  return { sWh: Math.floor(s.tradeWh), bWh: Math.floor(b.reportedWh), soc: s.socBps, stop };
}

test('honest trade agrees within tolerance and stops at maxWh', () => {
  const r = runTrade();
  assert.equal(r.stop, 'max_reached');
  assert.ok(Math.abs(r.sWh - 300) <= 1, `seller ${r.sWh}`);
  assert.ok(agree(r.sWh, r.bWh), `${r.sWh} vs ${r.bWh}`);
});

test('tampered buyer meter produces a dispute', () => {
  const r = runTrade({ tamper: true });
  assert.ok(!agree(r.sWh, r.bWh));
});

test('seller never reports a state of charge below the contract floor', () => {
  const r = runTrade({ maxWh: 5000, hours: 5 });
  assert.equal(r.stop, 'soc_floor');
  assert.ok(r.soc >= 2000, `soc ${r.soc}`);
  assert.ok(agree(r.sWh, r.bWh));
});

test('solar surplus charges only up to the 80% ceiling and reports curtailment', () => {
  const s = new SellerModel({}, 0.5);
  let last;
  for (let i = 0; i < 4 * 3600; i++) last = s.step(900, 100, false, DT);
  assert.ok(s.socBps <= 8000 && s.socBps >= 7990);
  assert.ok(last.curtailedW > 700);
});

test('no export while the grid is available', () => {
  const s = new SellerModel({}, 0.8);
  s.startTrade(1, 300, 250);
  const o = s.step(0, 50, false, DT);
  assert.equal(o.exportW, 0);
});
