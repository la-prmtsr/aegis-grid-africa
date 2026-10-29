// Stage 5B.3 evidence rules (Faras's two-ESP32 Wokwi setup), kept free of MQTT and wallets so they can be
// unit-tested (test/evidence.test.mjs).
//
// METER_A and METER_B publish their own final events on meter/METER_A/final and meter/METER_B/final.
// Those events are UNSIGNED and SIMULATED, and METER_B is derived from METER_A
// (independentPhysicalMeasurement:false). The backend therefore:
//   1. validates and stores every final (dedupe key: site, tradeId, meterId, role),
//   2. checks the pair twice: on the original fractional Wh, then on the whole Wh (uint64) that would
//      actually be sent to the contract. Values are never adjusted to make a check pass,
//   3. with SETTLEMENT_MODE=off (default) stops at SIMULATION_VERIFIED: nothing goes on-chain,
//   4. with SETTLEMENT_MODE=testnet asks the two gateways (separate processes, separate registered keys)
//      to sign their own meter's final, and labels the result SIMULATED_TESTNET_SETTLEMENT.

export const STATUS = Object.freeze({
  PENDING: 'PENDING', // buyer request accepted, escrow being opened
  ACTIVE: 'ACTIVE', // escrow open, START sent to METER_A
  STOPPED: 'STOPPED', // STOP sent (or METER_A ended the trade itself)
  AWAITING_EVIDENCE: 'AWAITING_EVIDENCE', // waiting for the second final
  SIMULATION_VERIFIED: 'SIMULATION_VERIFIED', // both finals consistent; settlement off
  REJECTED: 'REJECTED', // evidence failed a check: nothing is sent on-chain
  SIGNING: 'SIGNING', // testnet: gateways asked to sign
  SETTLED: 'SETTLED', // testnet: settleTrade paid
  DISPUTED: 'DISPUTED', // testnet: contract froze the deposit
  FAILED: 'FAILED', // testnet: transaction failed
});
export const LABEL_TESTNET = 'SIMULATED_TESTNET_SETTLEMENT';
export const ROLE_OF = Object.freeze({ METER_A: 'seller', METER_B: 'buyer' });

/** Accepts the firmware's tradeId string; returns the on-chain id or null for test ids like "test-003". */
export function chainIdOf(tradeId) {
  return typeof tradeId === 'string' && /^[1-9]\d{0,17}$/.test(tradeId) ? Number(tradeId) : null;
}

/**
 * Check one final event on its own. Returns { ok, reason, final } where final is a normalised copy.
 * topicMeterId comes from the MQTT topic (meter/<id>/final) and must match the payload.
 */
export function validateFinal(payload, { site, topicMeterId }) {
  const bad = (reason) => ({ ok: false, reason });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return bad('payload is not a JSON object');
  if (payload.site !== site) return bad(`wrong site "${payload.site}"`);
  if (!(payload.meterId in ROLE_OF)) return bad(`unknown meterId "${payload.meterId}"`);
  if (payload.meterId !== topicMeterId) return bad(`meterId ${payload.meterId} published on the ${topicMeterId} topic`);
  if (payload.role !== ROLE_OF[payload.meterId]) return bad(`${payload.meterId} must have role ${ROLE_OF[payload.meterId]}`);
  if (typeof payload.tradeId !== 'string' || payload.tradeId.length < 1 || payload.tradeId.length > 64) return bad('tradeId must be a string of 1-64 characters');
  const wh = payload.wh;
  if (typeof wh !== 'number' || !Number.isFinite(wh) || wh < 0) return bad('wh must be a finite number >= 0');
  if (payload.role === 'seller') {
    const soc = payload.socBpsAfter;
    if (!Number.isInteger(soc) || soc < 0 || soc > 10000) return bad('socBpsAfter must be an integer 0-10000');
  }
  return {
    ok: true,
    final: {
      site: payload.site,
      meterId: payload.meterId,
      role: payload.role,
      tradeId: payload.tradeId,
      wh,
      socBpsAfter: payload.role === 'seller' ? payload.socBpsAfter : undefined,
      reason: payload.reason ?? null,
      tamper: payload.tamper ?? null,
      simulated: payload.simulated !== false,
      independentPhysicalMeasurement: payload.independentPhysicalMeasurement === true,
    },
  };
}

export const dedupeKey = (f) => [f.site, f.tradeId, f.meterId, f.role].join('|');

/** Whole Wh actually sent to the contract (uint64). Floor: never claims more than the meter measured. */
export const toContractWh = (wh) => Math.floor(wh);

/**
 * Two-stage check of a seller/buyer pair.
 * @returns {{ ok, stage, reason, frac, int }} stage = 'fraction' | 'integer' | 'passed'
 *   frac: { sellerWh, buyerWh, gapPct }   int: { sellerWh, buyerWh, gapPct } (only when reached)
 * opts: { toleranceBps, minSettleWh (0 = no minimum), maxWh, minSocBps, integer (run stage 2) }
 */
export function verifyPair(seller, buyer, { toleranceBps, minSettleWh = 0, maxWh = Infinity, minSocBps = 0, integer = false }) {
  const tol = toleranceBps / 10000;
  const s = seller.wh;
  const b = buyer.wh;
  const frac = { sellerWh: s, buyerWh: b, gapPct: s > 0 ? ((s - b) / s) * 100 : null };
  const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, frac, ...extra });

  if (seller.tradeId !== buyer.tradeId) return fail('fraction', 'finals belong to different trades');
  if (!(s > 0)) return fail('fraction', 'seller sent no energy');
  if (!(b > 0)) return fail('fraction', 'buyer received no energy');
  if (b > s) return fail('fraction', `buyer reports more than the seller sent (${b} > ${s} Wh)`);
  if ((s - b) > s * tol) return fail('fraction', `gap ${frac.gapPct.toFixed(3)}% exceeds ${toleranceBps / 100}%`);
  if (s < minSettleWh) return fail('fraction', `seller energy ${s} Wh is below the ${minSettleWh} Wh settlement minimum`);
  if (!integer) return { ok: true, stage: 'passed', reason: 'fractional finals consistent', frac };

  // Stage 2: exactly the uint64 values the contract will check (same cross-multiplied rule as AegisEscrow).
  const si = toContractWh(s);
  const bi = toContractWh(b);
  const int = { sellerWh: si, buyerWh: bi, gapPct: si > 0 ? ((si - bi) / si) * 100 : null };
  const failInt = (reason) => fail('integer', reason, { int });
  if (si < 1 || bi < 1) return failInt('a whole-Wh reading would be 0');
  if (si > maxWh || bi > maxWh) return failInt(`a reading exceeds the trade maximum of ${maxWh} Wh`);
  if (bi > si) return failInt('whole-Wh buyer reading exceeds the seller reading');
  if ((si - bi) * 10000 > si * toleranceBps) return failInt(`whole-Wh gap ${int.gapPct.toFixed(3)}% exceeds ${toleranceBps / 100}% (${si} vs ${bi} Wh)`);
  if (!(seller.socBpsAfter >= minSocBps)) return failInt(`seller battery ${seller.socBpsAfter / 100}% is below the ${minSocBps / 100}% reserve`);
  return { ok: true, stage: 'passed', reason: 'fractional and whole-Wh readings consistent', frac, int };
}
