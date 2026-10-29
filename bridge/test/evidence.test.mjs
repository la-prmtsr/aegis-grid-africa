// Stage 5B.3 evidence rules. Sample finals are Faras's captured test-003 readings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinal, verifyPair, chainIdOf, dedupeKey, toContractWh } from '../src/v2/evidence.js';

const SITE = 'ag-sakarya26';
const A = { v: 1, site: SITE, meterId: 'METER_A', role: 'seller', tradeId: 'test-003', wh: 2.472221, socBpsAfter: 5346, reason: 'stop_cmd', simulated: true, settlementEligible: false, signature: null };
const B = { v: 1, site: SITE, meterId: 'METER_B', role: 'buyer', tradeId: 'test-003', wh: 2.41404, tamper: false, reason: 'meter_a_stopped', simulated: true, independentPhysicalMeasurement: false, settlementEligible: false, signature: null };
const opts = { toleranceBps: 300, maxWh: 500, minSocBps: 500 };
const pair = (s, b, extra = {}) => verifyPair({ ...A, wh: s }, { ...B, wh: b }, { ...opts, ...extra });

test('validateFinal accepts Faras test-003 finals and keeps them marked simulated', () => {
  const a = validateFinal(A, { site: SITE, topicMeterId: 'METER_A' });
  const b = validateFinal(B, { site: SITE, topicMeterId: 'METER_B' });
  assert.ok(a.ok && b.ok);
  assert.equal(a.final.simulated, true);
  assert.equal(b.final.independentPhysicalMeasurement, false);
  assert.equal(dedupeKey(a.final), 'ag-sakarya26|test-003|METER_A|seller');
});

test('validateFinal rejects wrong site, role, topic, tradeId and Wh', () => {
  const v = (p, topicMeterId = 'METER_A') => validateFinal(p, { site: SITE, topicMeterId }).ok;
  assert.equal(v({ ...A, site: 'other' }), false);
  assert.equal(v({ ...A, role: 'buyer' }), false);
  assert.equal(v(A, 'METER_B'), false); // seller final on the buyer topic
  assert.equal(v({ ...A, tradeId: '' }), false);
  assert.equal(v({ ...A, tradeId: 'x'.repeat(65) }), false);
  assert.equal(v({ ...A, wh: -1 }), false);
  assert.equal(v({ ...A, wh: 'NaN' }), false);
  assert.equal(v({ ...A, socBpsAfter: 12000 }), false);
  assert.equal(v([A]), false);
});

test('chainIdOf only maps real escrow ids, never test ids', () => {
  assert.equal(chainIdOf('12'), 12);
  assert.equal(chainIdOf('test-003'), null);
  assert.equal(chainIdOf('012'), null);
  assert.equal(chainIdOf(12), null);
});

test('off mode: test-003 is consistent on the fractional values (2.353%)', () => {
  const r = pair(A.wh, B.wh);
  assert.equal(r.ok, true);
  assert.equal(r.frac.gapPct.toFixed(3), '2.353');
});

test('testnet: test-003 is below the 5 Wh settlement minimum', () => {
  const r = pair(A.wh, B.wh, { minSettleWh: 5, integer: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /below the 5 Wh/);
});

test('fraction stage rejects buyer > seller and a gap over 3%', () => {
  assert.match(pair(5.0, 5.1).reason, /more than the seller/);
  assert.match(pair(10, 9.6).reason, /exceeds 3%/);
  assert.match(pair(0, 0).reason, /no energy/);
});

test('integer stage: whole Wh that still agree pass, without changing values', () => {
  const r = pair(10.9, 10.65, { minSettleWh: 5, integer: true }); // 2.29%, whole 10 vs 10
  assert.equal(r.ok, true);
  assert.deepEqual([r.int.sellerWh, r.int.buyerWh], [10, 10]);
  assert.equal(toContractWh(10.999), 10);
});

test('integer stage blocks a pair that passes on fractions but fails as uint64', () => {
  const r = pair(33.9, 32.95, { minSettleWh: 5, integer: true }); // 2.80% fractional, 33 vs 32 = 3.03%
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'integer');
  assert.match(r.reason, /whole-Wh gap/);
});

test('integer stage enforces the trade maximum and the battery reserve', () => {
  assert.match(pair(600, 590, { integer: true }).reason, /maximum/);
  const low = verifyPair({ ...A, wh: 20.5, socBpsAfter: 400 }, { ...B, wh: 20.1 }, { ...opts, integer: true });
  assert.match(low.reason, /reserve/);
});
