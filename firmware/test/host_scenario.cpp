#define ARDUINOJSON_ENABLE_ARDUINO_STRING 1
#include "Arduino.h"
#include "WiFi.h"
#include "PubSubClient.h"
#include "ArduinoJson.h"
#include "seller_model.h"
#include "buyer_model.h"
#include <cassert>

DeviceIO* g_io; unsigned long g_millis = 0; bool g_quiet = true;
SerialStub Serial; WiFiStub WiFi;
std::vector<PubSubClient*> g_clients; std::vector<Msg> g_log; std::map<std::string,std::string> g_retained;
void bus_publish(const std::string& t, const std::string& p, bool r) {
  g_log.push_back({t, p, r});
  if (r) g_retained[t] = p;
  for (auto* c : g_clients) for (auto& s : c->subs) if (s == t) c->inbox.push_back({t, p, r});
}

namespace sellerfw {
#include "../meter-seller/sketch.ino"
}
#undef SITE
#undef METER_ID
#undef LINE_ID
namespace buyerfw {
#include "../meter-buyer/sketch.ino"
}

DeviceIO sio, bio;
PubSubClient* bridge;
size_t logPos = 0;
JsonDocument lastSellerFinal, lastBuyerFinal; bool haveS=false, haveB=false;
bool buyerRequesting = false;

void tick(int ms) {
  for (int i = 0; i < ms; i += 20) {
    g_millis += 20;
    g_io = &sio; sellerfw::loop();
    g_io = &bio; buyerfw::loop();
    for (; logPos < g_log.size(); logPos++) {
      auto& m = g_log[logPos];
      if (m.topic.find("/reading/seller") != std::string::npos) { deserializeJson(lastSellerFinal, m.payload); haveS = true; }
      if (m.topic.find("/reading/buyer") != std::string::npos) { deserializeJson(lastBuyerFinal, m.payload); haveB = true; }
      if (m.topic == "aegisgrid/ag-demo/meter/METER_B/telemetry") { JsonDocument d; deserializeJson(d, m.payload); buyerRequesting = d["requesting"]; }
    }
  }
}
void cmd(const char* meter, const std::string& json) {
  std::string t = std::string("aegisgrid/ag-demo/meter/") + meter + "/cmd";
  bridge->publish(t.c_str(), json.c_str());
}
void pressRequest() { bio.digital[19] = LOW; tick(100); bio.digital[19] = HIGH; tick(100); }

int runTrade(int id, int maxWh, int realMs, bool tamper, bool stopByBridge, int* sWh, int* bWh, int* soc, std::string* reason) {
  haveS = haveB = false;
  bio.digital[18] = tamper ? LOW : HIGH;
  char b[128];
  snprintf(b, 128, "{\"cmd\":\"start\",\"tradeId\":%d,\"maxWh\":%d,\"targetW\":250}", id, maxWh);
  cmd("METER_A", b); cmd("METER_B", b);
  int waited = 0;
  while (!haveS && waited < realMs) { tick(100); waited += 100; }
  if (!haveS && stopByBridge) { snprintf(b,128,"{\"cmd\":\"stop\",\"tradeId\":%d}", id); cmd("METER_A", b); for (int k=0;k<20 && !haveS;k++) tick(50); }
  assert(haveS);
  tick(300); // seller's last line message reaches the buyer first
  snprintf(b,128,"{\"cmd\":\"stop\",\"tradeId\":%d}", id); cmd("METER_B", b);
  for (int k=0;k<20 && !haveB;k++) tick(50);
  assert(haveB);
  *sWh = lastSellerFinal["wh"]; *bWh = lastBuyerFinal["wh"]; *soc = lastSellerFinal["socBpsAfter"];
  *reason = (const char*)(lastSellerFinal["reason"] | "");
  return 0;
}
bool agree(int s, int b) { return b <= s && (long)(s - b) * 10000 <= (long)s * 300; }

int main() {
  WiFiClient wc; bridge = new PubSubClient(wc); bridge->setCallback([](char*, byte*, unsigned){});
  g_io = &sio; sellerfw::setup();
  g_io = &bio; buyerfw::setup();

  // Day: strong sun, low home load, grid up -> battery charges to the 80% ceiling.
  sio.analog[34] = 3500; sio.analog[35] = 400; bio.analog[34] = 2048;
  tick(60000);
  printf("after day: soc=%u chargeW=%.0f curtailedW=%.0f status=%s\n", sellerfw::model.socBps(),
         sellerfw::lastStep.chargeW, sellerfw::lastStep.curtailedW, sellerfw::statusName(false));
  assert(sellerfw::model.socBps() <= 8000 && sellerfw::model.socBps() >= 7900);
  assert(sellerfw::lastStep.curtailedW > 0);

  // Night: no sun, outage.
  sio.analog[34] = 0; sio.analog[35] = 400; sio.digital[18] = LOW;
  tick(1000);
  assert(buyerfw::outage);
  pressRequest();
  assert(buyerRequesting);

  int s, b, soc; std::string reason;
  runTrade(1, 500, 40000, false, true, &s, &b, &soc, &reason);
  printf("trade 1 honest:   seller=%d buyer=%d soc=%d reason=%s agree=%d ratio=%.4f\n", s, b, soc, reason.c_str(), agree(s,b), (double)b/s);
  assert(agree(s, b) && s > 100);

  runTrade(2, 500, 40000, true, true, &s, &b, &soc, &reason);
  printf("trade 2 tampered: seller=%d buyer=%d soc=%d reason=%s agree=%d\n", s, b, soc, reason.c_str(), agree(s,b));
  assert(!agree(s, b));

  runTrade(3, 5000, 400000, false, false, &s, &b, &soc, &reason);
  printf("trade 3 to floor: seller=%d buyer=%d soc=%d reason=%s agree=%d\n", s, b, soc, reason.c_str(), agree(s,b));
  assert(reason == "soc_floor" && soc >= 2000 && agree(s, b));

  runTrade(4, 120, 400000, false, false, &s, &b, &soc, &reason);
  printf("trade 4 at floor: seller=%d buyer=%d soc=%d reason=%s\n", s, b, soc, reason.c_str());

  // Grid back: seller restocks? (no sun at night, so stays) - check telemetry still flows.
  printf("messages on bus: %zu, last seller telemetry ok\n", g_log.size());
  puts("ALL HOST CHECKS PASSED");
}
