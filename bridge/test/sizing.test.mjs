// Stage 6 order size: the dashboard (web/src/lib/sizing.js) and the backend (src/v2/sizing.js) must agree,
// otherwise the deposit the buyer sees would differ from the escrow the relayer opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bridge from '../src/v2/sizing.js';
import * as web from '../../web/src/lib/sizing.js';
import { verifyPair } from '../src/v2/evidence.js';

const REAL = { lineLoss: 0.02, powerW: 500, energyScale: 1 }; // Faras's 5B.2 firmware: real-time counter
const FAST = { lineLoss: 0.02, powerW: 500, energyScale: 60 }; // a counter at 60x

const settles = (s, b, maxWh = 1e9) => verifyPair({ tradeId: '1', wh: s, socBpsAfter: 5000 }, { tradeId: '1', wh: b }, { toleranceBps: 300, minSettleWh: 5, maxWh, minSocBps: 500, integer: true }).ok;

test('dashboard and backend use identical order-size rules', () => {
  for (const rate of [REAL, FAST, { ...REAL, powerW: 250 }, undefined]) {
    assert.deepEqual(bridge.orderSteps(rate), web.orderSteps(rate));
    for (let t = 0; t <= 600; t += 5) {
      assert.equal(bridge.clampOrder(t, 500, rate), web.clampOrder(t, 500, rate), `clamp ${t}`);
      assert.equal(bridge.maxWhFor(t, rate), web.maxWhFor(t, rate), `maxWh ${t}`);
      assert.equal(bridge.receivedEstimate(t), web.receivedEstimate(t), `estimate ${t}`);
      assert.equal(bridge.orderReached(t, 50, rate), web.orderReached(t, 50, rate), `stop ${t}`);
    }
  }
});

test('order steps follow the counter speed', () => {
  assert.equal(bridge.isFine(REAL), true);
  assert.equal(bridge.isFine(FAST), false);
  assert.equal(bridge.clampOrder(3, 500, REAL), 10);
  assert.equal(bridge.clampOrder(54, 500, REAL), 50);
  assert.equal(bridge.clampOrder(900, 500, REAL), 500);
  assert.equal(bridge.clampOrder('x', 500, REAL), 20);
  assert.equal(bridge.clampOrder(3, 500, FAST), 100);
  assert.equal(bridge.clampOrder(226, 500, FAST), 250);
  assert.equal(bridge.clampOrder('x', 500, FAST), 250);
});

/** 1 s reports; the stop lands `latencyS` after the decision. phase: where the order falls between two reports. */
function runOrder(target, rate, latencyS, phase) {
  const step = bridge.reportWh(rate);
  let seller = -phase * step;
  for (let i = 0; i < 100000; i++) {
    seller += step;
    if (bridge.orderReached(bridge.receivedEstimate(seller), target, rate)) break;
  }
  return seller + step * latencyS;
}

test('real-time counter: every order from 10 Wh settles, within 0.5 Wh of the order', () => {
  for (let target = 10; target <= 500; target += 10) {
    const maxWh = bridge.maxWhFor(target, REAL);
    for (const latencyS of [0, 0.5, 1, 1.5]) { // MQTT round trip to the firmware
      for (let phase = 0; phase < 1; phase += 0.1) {
        const s = runOrder(target, REAL, latencyS, phase);
        const b = s * 0.98; // METER_B firmware = METER_A × 0.98
        assert.ok(settles(s, b, maxWh), `order ${target}, latency ${latencyS}: ${s.toFixed(3)} vs ${b.toFixed(3)} Wh rejected`);
        assert.ok(b >= target && b - target < 0.5, `order ${target}: buyer ${b.toFixed(3)} Wh`);
      }
    }
  }
});

test('60x counter: orders from 100 Wh settle, land near the order and inside the escrow', () => {
  for (const target of [100, 150, 250, 350, 500]) {
    const maxWh = bridge.maxWhFor(target, FAST);
    for (const latencyS of [0, 0.5, 1, 1.5]) {
      for (let phase = 0; phase < 1; phase += 0.1) {
        const s = runOrder(target, FAST, latencyS, phase);
        assert.ok(settles(s, s * 0.98, maxWh), `order ${target}, latency ${latencyS}: seller ${s.toFixed(2)} (maxWh ${maxWh})`);
        assert.ok(Math.abs(s * 0.98 - target) <= 8.2 * (0.5 + latencyS), `order ${target}: buyer ${(s * 0.98).toFixed(2)}`);
      }
    }
  }
});

test('why: stopping at a random point can fail the whole-Wh check below about 67 Wh', () => {
  assert.equal(settles(23.19, 22.73), false); // live test trade 8: 23 vs 22 whole Wh = 4.3% gap
  for (let s = 67; s < 600; s += 0.01) assert.ok(settles(s, s * 0.98), `seller ${s.toFixed(2)} Wh rejected`);
});
