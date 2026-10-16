// Energy model of the seller's meter (battery owner, METER_A).
// Pure C++ with no Arduino dependency, so it also runs in the host test (firmware/test).
// All numbers below are design parameters for the simulation, not measured values.
#pragma once
#include <stdint.h>

namespace aegis {

struct SellerConfig {
  float capacityWh = 1000.0f;      // battery capacity
  float maxPowerW = 500.0f;        // inverter limit, charge or discharge
  float chargeEff = 0.95f;
  float dischargeEff = 0.95f;
  float minSoc = 0.21f;            // 20% contract floor + 1 point margin for rounding
  float maxSoc = 0.80f;            // battery-health ceiling (20-80% window)
};

enum class StopReason : uint8_t { None = 0, StopCmd, MaxReached, SocFloor };

inline const char* stopReasonName(StopReason r) {
  switch (r) {
    case StopReason::StopCmd: return "stop_cmd";
    case StopReason::MaxReached: return "max_reached";
    case StopReason::SocFloor: return "soc_floor";
    default: return "none";
  }
}

struct SellerStep {
  float chargeW = 0, curtailedW = 0, dischargeLocalW = 0, exportW = 0, unservedLocalW = 0;
  StopReason stop = StopReason::None;  // set when the model ended the trade itself
};

class SellerModel {
 public:
  explicit SellerModel(const SellerConfig& c = SellerConfig(), float startSoc = 0.5f)
      : cfg(c), batteryWh(c.capacityWh * startSoc) {}

  SellerConfig cfg;
  float batteryWh;
  double exportWhTotal = 0;  // lifetime counter, like a real meter register

  // Active trade
  uint32_t tradeId = 0;
  float tradeWh = 0;
  float maxWh = 0;
  float targetW = 0;

  bool trading() const { return tradeId != 0; }

  void startTrade(uint32_t id, float maxWhIn, float targetWIn) {
    tradeId = id;
    tradeWh = 0;
    maxWh = maxWhIn;
    targetW = targetWIn;
  }
  void endTrade() { tradeId = 0; targetW = 0; }

  float soc() const { return batteryWh / cfg.capacityWh; }
  // Integer basis points, rounded down (what the contract receives).
  uint16_t socBps() const {
    float b = soc() * 10000.0f;
    if (b < 0) b = 0;
    if (b > 10000) b = 10000;
    return (uint16_t)b;
  }

  // Advance the model by dtH simulated hours.
  SellerStep step(float pvW, float loadW, bool outage, float dtH) {
    SellerStep o;
    if (dtH <= 0) return o;

    const float surplusW = pvW > loadW ? pvW - loadW : 0;
    const float deficitW = loadW > pvW ? loadW - pvW : 0;

    // Charge from solar surplus up to the health ceiling.
    const float headroomWh = cfg.maxSoc * cfg.capacityWh - batteryWh;
    float chargeLimitW = headroomWh > 0 ? headroomWh / (cfg.chargeEff * dtH) : 0;
    o.chargeW = minf(surplusW, minf(cfg.maxPowerW, chargeLimitW));
    o.curtailedW = surplusW - o.chargeW;

    // Discharge budget above the floor.
    const float availWh = batteryWh - cfg.minSoc * cfg.capacityWh;
    float budgetW = availWh > 0 ? minf(cfg.maxPowerW, availWh * cfg.dischargeEff / dtH) : 0;
    budgetW = maxf(0, budgetW - o.chargeW);  // inverter shared between charging and discharging

    if (outage) {
      // Islanded microgrid: the owner's own home is served first.
      o.dischargeLocalW = minf(deficitW, budgetW);
      o.unservedLocalW = deficitW - o.dischargeLocalW;
      budgetW -= o.dischargeLocalW;

      if (trading()) {
        float w = minf(targetW, budgetW);
        const float leftWh = maxWh - tradeWh;
        if (leftWh <= 0) {
          w = 0;
        } else if (w * dtH >= leftWh) {
          w = leftWh / dtH;
          o.stop = StopReason::MaxReached;
        }
        o.exportW = w > 0 ? w : 0;
        // Battery has reached the floor: end the trade instead of trickling.
        const float availAfterWh = availWh - (o.dischargeLocalW + o.exportW) / cfg.dischargeEff * dtH;
        if (o.stop == StopReason::None && availAfterWh < 0.5f) o.stop = StopReason::SocFloor;
      }
    }
    // With the grid available, the grid covers the home and no P2P export is needed.

    batteryWh += o.chargeW * cfg.chargeEff * dtH;
    batteryWh -= (o.dischargeLocalW + o.exportW) / cfg.dischargeEff * dtH;
    if (batteryWh < 0) batteryWh = 0;
    if (batteryWh > cfg.capacityWh) batteryWh = cfg.capacityWh;

    const float e = o.exportW * dtH;
    tradeWh += e;
    exportWhTotal += e;
    return o;
  }

 private:
  static float minf(float a, float b) { return a < b ? a : b; }
  static float maxf(float a, float b) { return a > b ? a : b; }
};

}  // namespace aegis
