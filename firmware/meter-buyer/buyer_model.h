// Energy model of the buyer's meter (shop, METER_B).
// Pure C++ with no Arduino dependency, so it also runs in the host test (firmware/test).
// Line loss and the tamper factor are design parameters for the simulation.
#pragma once
#include <stdint.h>

namespace aegis {

struct BuyerConfig {
  float lineLoss = 0.02f;      // 2% cable loss between the two meters (within the 3% tolerance)
  float tamperFactor = 0.60f;  // a tampered meter reports 60% of what arrived (fraud demo)
};

struct BuyerStep {
  float importW = 0, unservedW = 0;
};

class BuyerModel {
 public:
  explicit BuyerModel(const BuyerConfig& c = BuyerConfig()) : cfg(c) {}

  BuyerConfig cfg;
  double importWhTotal = 0;  // lifetime counter of what this meter recorded

  uint32_t tradeId = 0;
  float arrivedWh = 0;   // energy that physically arrived in this trade
  float reportedWh = 0;  // what this meter records (differs only when tampered)
  bool tamper = false;

  bool trading() const { return tradeId != 0; }

  void startTrade(uint32_t id) {
    tradeId = id;
    arrivedWh = 0;
    reportedWh = 0;
    pendingWh = 0;
  }
  void endTrade() { tradeId = 0; }

  // Line message from the seller: cumulative energy injected for this trade.
  // Returns false if it belongs to another trade.
  bool onLine(uint32_t id, float whSent) {
    if (!trading() || id != tradeId) return false;
    const float arrived = whSent * (1.0f - cfg.lineLoss);
    if (arrived > arrivedWh) {
      pendingWh += arrived - arrivedWh;  // energy to account for in the next step
      const float delta = arrived - arrivedWh;
      arrivedWh = arrived;
      const float rec = tamper ? delta * cfg.tamperFactor : delta;
      reportedWh += rec;
      importWhTotal += rec;
    }
    return true;
  }

  // Advance by dtH simulated hours. importW is derived from energy received since the last step.
  BuyerStep step(float loadW, bool outage, float dtH) {
    BuyerStep o;
    if (dtH <= 0) return o;
    o.importW = pendingWh / dtH;
    pendingWh = 0;
    // Smooth the bursty 4 Hz line messages for display.
    smoothW = smoothW * 0.85f + o.importW * 0.15f;
    o.importW = smoothW;
    o.unservedW = outage && loadW > o.importW ? loadW - o.importW : 0;
    return o;
  }

 private:
  float pendingWh = 0;
  float smoothW = 0;
};

}  // namespace aegis
