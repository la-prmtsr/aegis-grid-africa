// JavaScript port of firmware/meter-seller/seller_model.h and firmware/meter-buyer/buyer_model.h.
// Keep the two in sync: the mock meters must behave like the Wokwi meters.
// All numbers are design parameters for the simulation, not measured values.

export const SELLER_DEFAULTS = {
  capacityWh: 1000,
  maxPowerW: 500,
  chargeEff: 0.95,
  dischargeEff: 0.95,
  minSoc: 0.21, // 20% contract floor + 1 point margin for rounding
  maxSoc: 0.8,
};

export class SellerModel {
  constructor(cfg = {}, startSoc = 0.5) {
    this.cfg = { ...SELLER_DEFAULTS, ...cfg };
    this.batteryWh = this.cfg.capacityWh * startSoc;
    this.exportWhTotal = 0;
    this.tradeId = 0;
    this.tradeWh = 0;
    this.maxWh = 0;
    this.targetW = 0;
  }

  get trading() {
    return this.tradeId !== 0;
  }

  startTrade(id, maxWh, targetW) {
    Object.assign(this, { tradeId: id, tradeWh: 0, maxWh, targetW });
  }

  endTrade() {
    this.tradeId = 0;
    this.targetW = 0;
  }

  get soc() {
    return this.batteryWh / this.cfg.capacityWh;
  }

  get socBps() {
    return Math.min(10000, Math.max(0, Math.floor(this.soc * 10000)));
  }

  /** Advance by dtH simulated hours. Returns the power flows and an optional stop reason. */
  step(pvW, loadW, outage, dtH) {
    const c = this.cfg;
    const o = { chargeW: 0, curtailedW: 0, dischargeLocalW: 0, exportW: 0, unservedLocalW: 0, stop: null };
    if (dtH <= 0) return o;

    const surplusW = Math.max(0, pvW - loadW);
    const deficitW = Math.max(0, loadW - pvW);

    const headroomWh = c.maxSoc * c.capacityWh - this.batteryWh;
    const chargeLimitW = headroomWh > 0 ? headroomWh / (c.chargeEff * dtH) : 0;
    o.chargeW = Math.min(surplusW, c.maxPowerW, chargeLimitW);
    o.curtailedW = surplusW - o.chargeW;

    const availWh = this.batteryWh - c.minSoc * c.capacityWh;
    let budgetW = availWh > 0 ? Math.min(c.maxPowerW, (availWh * c.dischargeEff) / dtH) : 0;
    budgetW = Math.max(0, budgetW - o.chargeW);

    if (outage) {
      o.dischargeLocalW = Math.min(deficitW, budgetW);
      o.unservedLocalW = deficitW - o.dischargeLocalW;
      budgetW -= o.dischargeLocalW;

      if (this.trading) {
        let w = Math.min(this.targetW, budgetW);
        const leftWh = this.maxWh - this.tradeWh;
        if (leftWh <= 0) w = 0;
        else if (w * dtH >= leftWh) {
          w = leftWh / dtH;
          o.stop = 'max_reached';
        }
        o.exportW = Math.max(0, w);
        const availAfterWh = availWh - ((o.dischargeLocalW + o.exportW) / c.dischargeEff) * dtH;
        if (!o.stop && availAfterWh < 0.5) o.stop = 'soc_floor';
      }
    }

    this.batteryWh += o.chargeW * c.chargeEff * dtH;
    this.batteryWh -= ((o.dischargeLocalW + o.exportW) / c.dischargeEff) * dtH;
    this.batteryWh = Math.min(c.capacityWh, Math.max(0, this.batteryWh));

    const e = o.exportW * dtH;
    this.tradeWh += e;
    this.exportWhTotal += e;
    return o;
  }
}

export const BUYER_DEFAULTS = {
  lineLoss: 0.02, // 2% cable loss, inside the contract's 3% tolerance
  tamperFactor: 0.6, // a tampered meter reports 60% of what arrived (fraud demo)
};

export class BuyerModel {
  constructor(cfg = {}) {
    this.cfg = { ...BUYER_DEFAULTS, ...cfg };
    this.importWhTotal = 0;
    this.tradeId = 0;
    this.arrivedWh = 0;
    this.reportedWh = 0;
    this.tamper = false;
    this._pendingWh = 0;
    this._smoothW = 0;
  }

  get trading() {
    return this.tradeId !== 0;
  }

  startTrade(id) {
    Object.assign(this, { tradeId: id, arrivedWh: 0, reportedWh: 0, _pendingWh: 0 });
  }

  endTrade() {
    this.tradeId = 0;
  }

  onLine(id, whSent) {
    if (!this.trading || id !== this.tradeId) return false;
    const arrived = whSent * (1 - this.cfg.lineLoss);
    if (arrived > this.arrivedWh) {
      const delta = arrived - this.arrivedWh;
      this._pendingWh += delta;
      this.arrivedWh = arrived;
      const rec = this.tamper ? delta * this.cfg.tamperFactor : delta;
      this.reportedWh += rec;
      this.importWhTotal += rec;
    }
    return true;
  }

  step(loadW, outage, dtH) {
    const o = { importW: 0, unservedW: 0 };
    if (dtH <= 0) return o;
    const raw = this._pendingWh / dtH;
    this._pendingWh = 0;
    this._smoothW = this._smoothW * 0.85 + raw * 0.15;
    o.importW = this._smoothW;
    o.unservedW = outage && loadW > o.importW ? loadW - o.importW : 0;
    return o;
  }
}
