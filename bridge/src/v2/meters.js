// Meter logic for v2, kept free of MQTT and wallets so it can be unit-tested (test/v2.test.mjs).
//
// Meter A (seller) = Faras's Wokwi ESP32 (Stage 4E telemetry) + this gateway, which counts the energy
// exported to the buyer per trade. Meter B (buyer) = a separate simulated meter with its own key.
//
// Both meters integrate energy with the SAME rule, so honest readings differ only by line loss:
//   energy of interval (k-1, k] = power reported in message k-1 × simulated duration of the interval
// Intervals longer than maxGapS count as zero (no energy is invented across a telemetry gap).
import { inspectTelemetry, allocate } from '../aegis-unity/core.mjs';

const r1 = (x) => Math.round(x * 10) / 10;
const EFF = 0.95; // charge/discharge efficiency assumed by the time-scale estimator only

// ------------------------------------------------------------------ Meter A gateway
export class MeterAGateway {
  constructor({ site = 'ag-sakarya26', sim, epoch = Date.now() } = {}) {
    if (!sim) throw new Error('sim settings required');
    this.site = site;
    this.sim = sim;
    this.epoch = epoch; // lets Meter B tell a restarted gateway apart (seq starts again at 1)
    this.seq = 0;
    this.lastTs = null;
    this.prevExportW = 0;
    this.prevBatteryWh = null;
    this.simMin = 0;
    this.exportWhTotal = 0;
    this.trade = null; // { id, maxWh, wh, tagged, issues:Set }
    this.last = null; // last normalized telemetry
    this.scaleSamples = [];
  }

  start({ tradeId, maxWh }) {
    const id = Number(tradeId);
    if (!id || !(Number(maxWh) > 0)) throw new Error('start needs tradeId and maxWh');
    const superseded = this.trade && this.trade.id !== id ? this.stop('superseded') : null;
    if (this.trade?.id === id) return superseded; // duplicate start
    this.trade = { id, maxWh: Number(maxWh), wh: 0, tagged: false, issues: new Set(), gaps: 0 };
    return superseded;
  }

  /** Ends the trade and returns the unsigned final reading (or null if no trade). */
  stop(reason = 'stop_cmd') {
    const tr = this.trade;
    if (!tr) return null;
    this.trade = null;
    return {
      v: 2,
      tradeId: tr.id,
      role: 'seller',
      meterId: 'METER_A',
      wh: Math.round(Math.min(tr.wh, tr.maxWh)),
      whExact: tr.wh,
      socBpsAfter: this.last ? Math.round(this.last.socPct * 100) : null,
      lastSeq: this.seq,
      epoch: this.epoch,
      reason,
      issues: [...tr.issues],
      gaps: tr.gaps,
      simulated: true,
    };
  }

  /**
   * One Stage 4E message from Wokwi. Returns { telemetry, issues, final } where telemetry is the
   * dashboard message for meter/METER_A/telemetry and final is set when the trade ended by itself.
   * Throws only on malformed input (wrong site, non-numeric fields).
   */
  onWokwi(raw, nowMs) {
    const { telemetry: t, issues } = inspectTelemetry(raw, { site: this.site });
    const alloc = allocate(t);
    const seq = ++this.seq;

    let intervalS = 0;
    let gap = false;
    if (this.lastTs !== null) {
      const dt = (nowMs - this.lastTs) / 1000;
      if (dt < 0 || dt > this.sim.maxGapS) gap = true;
      else intervalS = dt;
    }
    this.lastTs = nowMs;
    const intervalSimS = intervalS * this.sim.timeScale;
    this.simMin += intervalSimS / 60;

    this.estimateTimeScale(t, intervalS);

    // Physical P2P flow: during an outage the islanded microgrid serves the buyer first (Stage 4E policy).
    const exportW = t.grid === 'OUTAGE' ? alloc.buyerSuppliedW : 0;
    const communityW = t.grid === 'OUTAGE' ? alloc.communitySuppliedW : 0;

    const intervalExportW = this.prevExportW;
    let tradeCounted = false;
    let final = null;
    const tr = this.trade;
    if (tr) {
      if (tr.tagged) {
        // the previous message already belonged to this trade: count the interval
        let e = (intervalExportW * intervalSimS) / 3600;
        tradeCounted = true;
        tr.wh += e;
        this.exportWhTotal += e;
        issues.forEach((i) => tr.issues.add(i));
        if (gap) tr.gaps += 1; // both meters skip the same interval, so readings still agree
      }
      tr.tagged = true;
    }
    this.prevExportW = exportW;

    const curtailedW = Math.max(0, t.pvGeneratedW - t.pvDeliveredW);
    const status = this.status(t, exportW, curtailedW);

    const telemetry = {
      v: 2,
      meterId: 'METER_A',
      role: 'seller',
      seq,
      epoch: this.epoch,
      ts: nowMs,
      simMin: r1(this.simMin),
      timeScale: this.sim.timeScale,
      grid: t.grid,
      // fields the dashboard already understands (docs/integration-v2.md)
      pvW: r1(t.pvGeneratedW),
      loadW: r1(t.localW), // community load (City Hall, buildings) in the Stage 4E model
      chargeW: r1(t.chargeW),
      curtailedW: r1(curtailedW),
      dischargeLocalW: r1(communityW),
      exportW: r1(exportW),
      batteryWh: t.batteryWh === null ? null : r1(t.batteryWh),
      socBps: Math.round(t.socPct * 100),
      tradeId: tr ? tr.id : 0,
      tradeWh: tr ? r1(tr.wh) : 0,
      exportWhTotal: Math.floor(this.exportWhTotal),
      status,
      // Stage 4E details
      buyerRequest: t.buyerRequest,
      buyerDemandW: r1(t.buyerDemandW),
      backupAllowed: t.backupAllowed,
      unservedW: r1(t.unservedW),
      gridImportW: r1(t.gridImportW),
      pvDeliveredW: r1(t.pvDeliveredW),
      dischargeW: r1(t.dischargeW),
      minSocPct: this.sim.minSocPct,
      energyStatus: t.energyStatus,
      allocation: {
        buyerW: r1(alloc.buyerSuppliedW), communityW: r1(alloc.communitySuppliedW),
        cityHallW: r1(alloc.cityHallW), lowPolyW: r1(alloc.lowPolyW), motelW: r1(alloc.motelW),
      },
      // integration evidence used by Meter B
      intervalS: r1(intervalS * 1000) / 1000,
      intervalSimS: Math.round(intervalSimS * 1000) / 1000,
      intervalExportW: r1(intervalExportW),
      tradeCounted,
      gap,
      issues,
      wokwiTimeScaleEstimate: this.timeScaleEstimate(),
      simulated: true,
    };
    this.last = t;

    // The gateway ends a trade by itself at the trade cap or when the battery reserve is reached.
    if (tr && this.trade === tr) {
      if (tr.wh >= tr.maxWh) final = this.stop('max_reached');
      else if (t.grid === 'OUTAGE' && tr.wh > 0 && exportW < 1 && t.socPct <= this.sim.minSocPct + 0.1) final = this.stop('soc_floor');
    }
    return { telemetry, issues, final };
  }

  status(t, exportW, curtailedW) {
    if (this.trade && t.grid !== 'OUTAGE') return 'WAIT_OUTAGE';
    if (exportW > 0.1) return 'EXPORTING';
    if (t.grid === 'OUTAGE') return t.socPct <= this.sim.minSocPct + 0.1 ? 'SOC_FLOOR' : 'ISLAND';
    if (t.chargeW > 0.1) return 'CHARGING';
    if (curtailedW > 0.1 && t.socPct >= 99.5) return 'BATTERY_FULL';
    return 'IDLE_GRID';
  }

  // How fast does the Wokwi battery model run? Compares the change in battery energy with the
  // reported power. Diagnostic only: it does not change any reading.
  estimateTimeScale(t, intervalS) {
    const prev = this.prevBatteryWh;
    this.prevBatteryWh = t.batteryWh;
    if (prev === null || t.batteryWh === null || intervalS <= 0) return;
    const netW = t.chargeW * EFF - t.dischargeW / EFF;
    if (Math.abs(netW) < 50 || t.socPct >= 99.5 || t.socPct <= this.sim.minSocPct + 0.5) return;
    const expectedWhRealTime = (netW * intervalS) / 3600;
    const scale = (t.batteryWh - prev) / expectedWhRealTime;
    if (Number.isFinite(scale) && scale > 0) {
      this.scaleSamples.push(scale);
      if (this.scaleSamples.length > 60) this.scaleSamples.shift();
    }
  }

  timeScaleEstimate() {
    if (this.scaleSamples.length < 5) return null;
    const s = [...this.scaleSamples].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)] * 10) / 10;
  }
}

// ------------------------------------------------------------------ Meter B (buyer)
export class MeterBSim {
  constructor({ sim } = {}) {
    if (!sim) throw new Error('sim settings required');
    this.sim = sim;
    this.tamper = false;
    this.trade = null; // { id, maxWh, arrivedWh, reportedWh, stopUntil }
    this.importWhTotal = 0;
    this.epoch = null;
    this.lastSeq = 0;
    this.seq = 0;
  }

  start({ tradeId, maxWh }) {
    const id = Number(tradeId);
    if (!id || !(Number(maxWh) > 0)) throw new Error('start needs tradeId and maxWh');
    if (this.trade?.id === id) return null;
    const superseded = this.trade ? this.finalize('superseded', true) : null;
    this.trade = { id, maxWh: Number(maxWh), arrivedWh: 0, reportedWh: 0, stopUntil: null };
    return superseded;
  }

  /** Stop after the seller's last counted message (untilSeq). Returns the final if already reached. */
  stop({ tradeId, untilSeq }) {
    const tr = this.trade;
    if (!tr || Number(tradeId) !== tr.id) return null;
    tr.stopUntil = Number.isFinite(Number(untilSeq)) ? Number(untilSeq) : this.lastSeq;
    return this.lastSeq >= tr.stopUntil ? this.finalize('stop_cmd') : null;
  }

  /** Called when the seller's last message never arrives (lost packet): close with what was measured. */
  forceStop() {
    return this.trade ? this.finalize('stop_timeout', true) : null;
  }

  finalize(reason, incomplete = false) {
    const tr = this.trade;
    this.trade = null;
    return {
      v: 2,
      tradeId: tr.id,
      role: 'buyer',
      meterId: 'METER_B',
      wh: Math.round(Math.min(tr.reportedWh, tr.maxWh)),
      whExact: tr.reportedWh,
      arrivedWhExact: tr.arrivedWh,
      tamper: this.tamper,
      lastSeq: this.lastSeq,
      reason,
      incomplete,
      simulated: true,
    };
  }

  /**
   * One Meter A message (the physical feed of the simulation). Returns { telemetry, final }.
   * Duplicates (QoS 1 redelivery) are ignored.
   */
  onSellerTelemetry(m) {
    if (m.epoch !== this.epoch) {
      this.epoch = m.epoch; // gateway restarted: sequence numbers start again
      this.lastSeq = 0;
    } else if (m.seq <= this.lastSeq) {
      return { telemetry: null, final: null };
    }
    this.lastSeq = m.seq;

    const keep = 1 - this.sim.lineLoss;
    const importW = (Number(m.exportW) || 0) * keep;
    const tr = this.trade;
    if (tr && Number(m.tradeId) === tr.id && m.tradeCounted && (tr.stopUntil === null || m.seq <= tr.stopUntil)) {
      const arrived = ((Number(m.intervalExportW) || 0) * (Number(m.intervalSimS) || 0) / 3600) * keep;
      const recorded = this.tamper ? arrived * this.sim.tamperFactor : arrived;
      tr.arrivedWh += arrived;
      tr.reportedWh += recorded;
      this.importWhTotal += recorded;
    }
    const final = tr && tr.stopUntil !== null && m.seq >= tr.stopUntil ? this.finalize('stop_cmd') : null;

    const outage = m.grid === 'OUTAGE';
    const loadW = Number(m.buyerDemandW) || 0;
    const active = this.trade; // after a possible finalize
    const telemetry = {
      v: 2,
      meterId: 'METER_B',
      role: 'buyer',
      seq: ++this.seq,
      sellerSeq: m.seq,
      ts: m.ts,
      simMin: m.simMin,
      timeScale: m.timeScale,
      grid: m.grid,
      loadW: r1(loadW),
      importW: r1(importW),
      unservedW: r1(outage ? Math.max(0, loadW - importW) : 0),
      requesting: Boolean(m.buyerRequest) || Boolean(active),
      tamper: this.tamper,
      tradeId: active ? active.id : 0,
      tradeWh: active ? r1(active.reportedWh) : 0,
      importWhTotal: Math.floor(this.importWhTotal),
      status: importW > 1 ? 'RECEIVING' : m.buyerRequest || active ? (outage ? (active ? 'NO_SUPPLY' : 'REQUESTING') : 'REQUESTING') : outage ? 'NO_SUPPLY' : 'IDLE_GRID',
      lineLoss: this.sim.lineLoss,
      simulated: true,
    };
    return { telemetry, final };
  }
}

// ------------------------------------------------------------------ settlement decision
/**
 * Decide what the relayer does with two signed final readings.
 * - 'submit': send to the contract. It settles if the readings agree, otherwise it freezes the
 *   deposit as Disputed (on-chain evidence; refunding on mismatch would reward a tampered meter).
 * - 'hold': do not submit (the contract would revert or the evidence is not clean). The buyer can
 *   reclaim the deposit with refundExpired after the trade expires.
 */
export function settlementDecision({ seller, buyer, sellerSigOk, buyerSigOk, approvals, maxWh, toleranceBps, minSocBps }) {
  const hold = (reason) => ({ action: 'hold', reason });
  if (!approvals?.buyer || !approvals?.seller) return hold('Both-party approval required');
  if (!seller || !buyer) return hold('Both final readings required');
  if (seller.tradeId !== buyer.tradeId) return hold('Readings belong to different trades');
  if (!sellerSigOk || !buyerSigOk) return hold('A reading is not signed by the registered meter');
  if (seller.wh <= 0 || buyer.wh <= 0) return hold('Zero energy: nothing was delivered');
  if (seller.wh > maxWh || buyer.wh > maxWh) return hold('Reading exceeds the trade maximum');
  if (!(seller.socBpsAfter >= minSocBps)) return hold(`Seller battery below the ${minSocBps / 100}% reserve`);
  if (seller.issues?.length) return hold(`Telemetry rule violated during the trade: ${seller.issues.join('; ')}`);
  if (buyer.incomplete) return hold('Buyer meter missed the end of the trade');
  const agree = buyer.wh <= seller.wh && (seller.wh - buyer.wh) * 10000 <= seller.wh * toleranceBps;
  return agree
    ? { action: 'submit', expected: 'SETTLED', reason: 'Readings agree within tolerance' }
    : { action: 'submit', expected: 'DISPUTED', reason: 'Readings disagree: the contract will freeze the deposit' };
}
