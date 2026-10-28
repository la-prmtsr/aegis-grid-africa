export const TOPIC_ROOT = 'aegis-grid/ag-sakarya26';
export const TELEMETRY_TOPIC = `${TOPIC_ROOT}/demo/telemetry`;
export const MIN_SOC_PCT = 5;
export const LINE_LOSS = 0.02; // illustrative, not calibrated
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const numeric = (value, key) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error(`Invalid ${key}`);
  return value;
};
// Strict check (Stage 5A): throws on the first problem. Kept for the original tests and listen.mjs.
export function normalizeTelemetry(raw) {
  const { telemetry, issues } = inspectTelemetry(raw);
  if (issues.length) throw Error(issues[0]);
  return telemetry;
}

// Same checks, but rule violations are *reported* instead of dropping the message, so the dashboard
// keeps showing live data. Malformed input (wrong site/meter, non-numeric fields) still throws.
// Any issue makes the reading ineligible as settlement evidence (see bridge/src/v2).
export function inspectTelemetry(raw, { site = 'ag-sakarya26' } = {}) {
  if (!raw || raw.site !== site || raw.meter_id !== 'METER_A') throw Error('Incorrect site or meter');
  const pvGeneratedW = numeric(raw.pv_power_w, 'pv_power_w');
  const pvDeliveredW = numeric(raw.pv_delivered_to_microgrid_w, 'pv_delivered_to_microgrid_w');
  const demandW = numeric(raw.total_demand_w, 'total_demand_w');
  const localW = numeric(raw.local_load_w, 'local_load_w');
  const buyerDemandW = numeric(raw.buyer_demand_w, 'buyer_demand_w');
  const dischargeW = numeric(raw.battery_discharge_w, 'battery_discharge_w');
  const chargeW = numeric(raw.battery_charge_w, 'battery_charge_w');
  const gridImportW = numeric(raw.grid_import_w, 'grid_import_w');
  const unservedW = numeric(raw.unserved_power_w, 'unserved_power_w');
  const socPct = numeric(raw.battery_soc_pct, 'battery_soc_pct');
  if (socPct > 100 || !['AVAILABLE', 'OUTAGE'].includes(raw.grid_status)) throw Error('Invalid status/SoC');
  const issues = [];
  if (Math.abs(demandW - (localW + buyerDemandW)) > 1.5) issues.push('Inconsistent total demand');
  if (raw.grid_status === 'OUTAGE' && (pvDeliveredW > 0.5 || gridImportW > 0.5 || chargeW > 0.5)) issues.push('PCC isolation violation');
  if (socPct < MIN_SOC_PCT - 0.01) issues.push('Battery SoC below reserve');
  const telemetry = {site: raw.site, meterId: raw.meter_id, pvGeneratedW, pvDeliveredW, localW, buyerDemandW, demandW,
    dischargeW, chargeW, gridImportW, unservedW, socPct, grid: raw.grid_status,
    backupAllowed: raw.emergency_backup_allowed === true, buyerRequest: raw.buyer_request === true,
    batteryWh: Number.isFinite(raw.battery_energy_wh) ? raw.battery_energy_wh : null,
    energyStatus: typeof raw.energy_status === 'string' ? raw.energy_status : null,
    receivedAt: new Date().toISOString(), simulated: true};
  return { telemetry, issues };
}
// Allocation derives from *reported* served power, not raw demand.
// Community load is split evenly as an explicit Stage 4E demo policy.
export function allocate(t) {
  const servedTotalW = clamp(t.demandW - t.unservedW, 0, t.demandW);
  const buyerSuppliedW = t.buyerRequest ? Math.min(t.buyerDemandW, servedTotalW) : 0;
  const communitySuppliedW = Math.min(t.localW, Math.max(0, servedTotalW - buyerSuppliedW));
  const each = t.localW / 3;
  const cityHallW = Math.min(each, communitySuppliedW);
  const lowPolyW = Math.min(each, Math.max(0, communitySuppliedW - cityHallW));
  const motelW = Math.min(each, Math.max(0, communitySuppliedW - cityHallW - lowPolyW));
  return { buyerDemandW: t.buyerDemandW, buyerSuppliedW, communitySuppliedW, cityHallW, lowPolyW, motelW,
    unservedW: t.unservedW, simulated: true };
}
// Two-meter *simulation* evidence only. This is NOT an independently measured buyer reading.
export class DemoTradeMeter {
  constructor({lineLoss = LINE_LOSS, maxGapSeconds = 5} = {}) {
    if (lineLoss < 0 || lineLoss >= 1) throw Error('Invalid loss');
    this.loss = lineLoss; this.maxGapSeconds = maxGapSeconds; this.sentWh = 0; this.receivedWh = 0; this.lastMs = null;
  }
  add({sellerExportW, timestampMs}) {
    numeric(sellerExportW, 'sellerExportW');
    if (!Number.isFinite(timestampMs)) throw Error('Invalid timestamp');
    if (this.lastMs !== null) {
      const dt = (timestampMs - this.lastMs) / 1000;
      if (dt < 0) throw Error('Non-monotonic telemetry');
      if (dt > this.maxGapSeconds) { this.lastMs = timestampMs; return this.snapshot(); } // no invented energy during gap
      const wh = sellerExportW * dt / 3600;
      this.sentWh += wh; this.receivedWh += wh * (1 - this.loss);
    }
    this.lastMs = timestampMs; return this.snapshot();
  }
  snapshot() { return {sellerSentWh: this.sentWh, buyerReceivedWhEstimated: this.receivedWh,
    lineLossAssumption: this.loss, independentBuyerMeter: false, settlementEligible: false, simulated: true}; }
}
export function settlementGate({sellerFinal, buyerFinal, approvedSeller, approvedBuyer}) {
  if (!approvedSeller || !approvedBuyer) return {ok:false, reason:'Both-party approval required'};
  if (!sellerFinal?.signed || !buyerFinal?.signed || !buyerFinal?.independentlyMeasured)
    return {ok:false, reason:'Independent signed readings from both meters required'};
  if (sellerFinal.wh <= 0 || buyerFinal.wh <= 0) return {ok:false,reason:'Zero energy'};
  if (sellerFinal.socBpsAfter < 500) return {ok:false,reason:'SoC below 5%'};
  if (Math.abs(sellerFinal.wh - buyerFinal.wh) / sellerFinal.wh > 0.03)
    return {ok:false,reason:'Readings disagree beyond 3%'};
  return {ok:true,reason:'Eligible for contract verification; NOT settled'};
}
