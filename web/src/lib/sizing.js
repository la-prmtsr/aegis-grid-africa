// Stage 6 order size ("takaran"): the buyer chooses how many Wh to receive before requesting power.
// The SAME file is bridge/src/v2/sizing.js; bridge/test/sizing.test.mjs checks that both copies agree.
//
// rate = { lineLoss, powerW, energyScale }: published by the backend as backend/status params.orderRate.
//   powerW      TRADE_TARGET_W, the power METER_A delivers during a trade
//   energyScale how fast METER_A's trade counter (p2p_trade_wh) runs: 1 = real time (Faras's 5B.2 firmware,
//               FIRMWARE_ENERGY_SCALE=1), 60 = one real second counts as one simulated minute
// One meter report (1 s) then moves reportWh = powerW × energyScale / 3600 Wh: 0.14 Wh in real time at 500 W,
// 8.3 Wh at 60×.
//
// - Fine counter (≤ 0.4 Wh per report): orders of 10 Wh and up. The backend stops just past the order, so the
//   buyer's final lands a little above a whole Wh and the contract's whole-Wh 3% check always passes.
// - Coarse counter: orders of 100 Wh and up in 50 Wh steps (from about 67 Wh honest readings always pass the
//   whole-Wh check), stop half a report early so the final lands near the order.
// - The escrow keeps 2 reports of headroom on top of the order and the cable loss: the contract rejects a
//   reading above maxWh. The buyer pays only for what its meter received; the rest is refunded.

const REPORT_S = 1; // METER_A telemetry interval (real seconds)
const STOP_PAST_WH = 0.02; // fine counter: stop this far past the order (lands below the next whole Wh)
export const DEFAULT_RATE = { lineLoss: 0.02, powerW: 500, energyScale: 1 };

const rateOf = (rate) => ({ ...DEFAULT_RATE, ...(rate || {}) });

/** Seller-side energy (Wh) METER_A's trade counter moves in one report. */
export const reportWh = (rate) => { const r = rateOf(rate); return (r.powerW * r.energyScale * REPORT_S) / 3600; };

/** A fine counter can stop right after a whole Wh. */
export const isFine = (rate) => reportWh(rate) <= 0.4;

/** Allowed order sizes for this rate. */
export function orderSteps(rate) {
  return isFine(rate)
    ? { step: 10, min: 10, presets: [10, 20, 50, 100], def: 20 }
    : { step: 50, min: 100, presets: [100, 250, 500], def: 250 };
}

/** Clamp and round an order to the allowed steps. */
export function clampOrder(wh, maxOrderWh, rate) {
  const { step, min, def } = orderSteps(rate);
  const max = Math.max(min, Math.floor(maxOrderWh / step) * step);
  const n = Math.round(Number(wh) / step) * step;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : Math.min(max, def);
}

/** Escrow size (whole Wh) for an order: the order, the cable loss, 2 reports of stop margin and 2 Wh. */
export function maxWhFor(targetWh, rate) {
  const r = rateOf(rate);
  return targetWh + Math.ceil(targetWh * r.lineLoss) + Math.ceil(2 * reportWh(r)) + 2;
}

/** Live estimate of what the buyer has received, from the seller meter's cumulative trade counter. */
export const receivedEstimate = (sellerWh, lineLoss = 0.02) => (Number(sellerWh) || 0) * (1 - lineLoss);

/** Stop now? Fine counter: just past the order. Coarse counter: half a report early. */
export function orderReached(receivedWh, targetWh, rate) {
  const r = rateOf(rate);
  if (isFine(r)) return receivedWh >= targetWh + STOP_PAST_WH;
  return receivedWh + 0.5 * reportWh(r) * (1 - r.lineLoss) >= targetWh;
}
