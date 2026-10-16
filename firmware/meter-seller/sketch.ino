// Aegis-Grid Africa - Seller smart meter (METER_A), Wokwi simulation.
// Battery owner's meter: charges from solar surplus by day, exports P2P during load shedding.
// SIMULATION ONLY: potentiometers stand in for current/voltage sensors.
// Data format: docs/data-format.md (v1).

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "seller_model.h"

// ---------------------------------------------------------------- settings
#define SITE "ag-demo"                 // CHANGE to your team id, same everywhere (see docs)
#define METER_ID "METER_A"
#define LINE_ID "L1"
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const float TIME_SCALE = 60.0f;        // 1 real second = 1 simulated minute

// Pins (ADC1 pins only: ADC2 does not work while WiFi is on)
const int PV_PIN = 34;                 // potentiometer: sunlight / solar power
const int LOAD_PIN = 35;               // potentiometer: owner's home load
const int GRID_SWITCH_PIN = 18;        // slide switch: grid outage (load shedding)
const int LED_CHARGE = 25;             // green: charging from solar
const int LED_EXPORT = 26;             // yellow: exporting to buyer
const int LED_OUTAGE = 27;             // red: grid outage / island mode

const float MAX_PV_W = 1000.0f;
const float MAX_LOAD_W = 500.0f;

// ---------------------------------------------------------------- topics
const String P = String("aegisgrid/") + SITE + "/";
const String T_TELEMETRY = P + "meter/" METER_ID "/telemetry";
const String T_CMD = P + "meter/" METER_ID "/cmd";
const String T_GRID = P + "grid";
const String T_LINE = P + "line/" LINE_ID;

WiFiClient net;
PubSubClient mqtt(net);
aegis::SellerModel model;

unsigned long lastStepMs = 0, lastTelemetryMs = 0, lastLineMs = 0, lastGridMs = 0;
uint32_t seq = 0;
double simMinutes = 0;
bool lastOutage = false;
aegis::SellerStep lastStep;
float lastPvW = 0, lastLoadW = 0;

// ---------------------------------------------------------------- helpers
bool outageNow() { return digitalRead(GRID_SWITCH_PIN) == LOW; }

void publishGrid(bool outage) {
  JsonDocument d;
  d["v"] = 1;
  d["status"] = outage ? "OUTAGE" : "AVAILABLE";
  d["source"] = METER_ID;
  d["simulated"] = true;
  char buf[128];
  size_t n = serializeJson(d, buf);
  mqtt.publish(T_GRID.c_str(), (const uint8_t*)buf, n, true);  // retained
}

void publishLine();

void publishFinal(aegis::StopReason reason) {
  if (!model.trading()) return;
  publishLine();  // last cumulative value, so the buyer meter ends on the same number
  JsonDocument d;
  d["v"] = 1;
  d["tradeId"] = model.tradeId;
  d["role"] = "seller";
  d["meterId"] = METER_ID;
  d["wh"] = (uint32_t)model.tradeWh;          // integer, rounded down
  d["socBpsAfter"] = model.socBps();
  d["reason"] = aegis::stopReasonName(reason);
  d["simulated"] = true;
  char buf[200];
  size_t n = serializeJson(d, buf);
  String topic = P + "trade/" + String(model.tradeId) + "/reading/seller";
  mqtt.publish(topic.c_str(), (const uint8_t*)buf, n, true);  // retained
  Serial.printf("FINAL seller trade=%lu wh=%lu soc=%u reason=%s\n", (unsigned long)model.tradeId,
                (unsigned long)model.tradeWh, model.socBps(), aegis::stopReasonName(reason));
  model.endTrade();
}

const char* statusName(bool outage) {
  if (model.trading() && !outage) return "WAIT_OUTAGE";
  if (lastStep.exportW > 0.1f) return "EXPORTING";
  if (outage) return model.soc() <= model.cfg.minSoc + 0.005f ? "SOC_FLOOR" : "ISLAND";
  if (lastStep.chargeW > 0.1f) return "CHARGING";
  if (lastStep.curtailedW > 0.1f) return "BATTERY_FULL";  // surplus solar has nowhere to go
  return "IDLE_GRID";
}

void publishTelemetry(bool outage) {
  JsonDocument d;
  d["v"] = 1;
  d["meterId"] = METER_ID;
  d["role"] = "seller";
  d["seq"] = seq++;
  d["simMin"] = serialized(String(simMinutes, 1));
  d["timeScale"] = TIME_SCALE;
  d["grid"] = outage ? "OUTAGE" : "AVAILABLE";
  d["pvW"] = serialized(String(lastPvW, 1));
  d["loadW"] = serialized(String(lastLoadW, 1));
  d["chargeW"] = serialized(String(lastStep.chargeW, 1));
  d["curtailedW"] = serialized(String(lastStep.curtailedW, 1));
  d["dischargeLocalW"] = serialized(String(lastStep.dischargeLocalW, 1));
  d["exportW"] = serialized(String(lastStep.exportW, 1));
  d["batteryWh"] = serialized(String(model.batteryWh, 1));
  d["socBps"] = model.socBps();
  d["tradeId"] = model.tradeId;
  d["tradeWh"] = serialized(String(model.tradeWh, 1));
  d["exportWhTotal"] = (uint32_t)model.exportWhTotal;
  d["status"] = statusName(outage);
  d["simulated"] = true;
  char buf[512];
  size_t n = serializeJson(d, buf);
  mqtt.publish(T_TELEMETRY.c_str(), (const uint8_t*)buf, n);
  Serial.println(buf);
}

void publishLine() {
  JsonDocument d;
  d["tradeId"] = model.tradeId;
  d["whSent"] = serialized(String(model.tradeWh, 2));
  d["w"] = serialized(String(lastStep.exportW, 1));
  char buf[128];
  size_t n = serializeJson(d, buf);
  mqtt.publish(T_LINE.c_str(), (const uint8_t*)buf, n);
}

// Commands from the bridge
void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument d;
  if (deserializeJson(d, payload, len)) return;
  const char* cmd = d["cmd"] | "";
  uint32_t id = d["tradeId"] | 0;
  if (strcmp(cmd, "start") == 0 && id != 0) {
    if (model.trading() && model.tradeId != id) publishFinal(aegis::StopReason::StopCmd);
    model.startTrade(id, d["maxWh"] | 0.0f, d["targetW"] | 250.0f);
    Serial.printf("START trade=%lu maxWh=%.0f targetW=%.0f\n", (unsigned long)id, model.maxWh, model.targetW);
  } else if (strcmp(cmd, "target") == 0 && id == model.tradeId && model.trading()) {
    model.targetW = d["targetW"] | model.targetW;
  } else if (strcmp(cmd, "stop") == 0 && id == model.tradeId && model.trading()) {
    publishFinal(aegis::StopReason::StopCmd);
  }
}

void connectWifi() {
  Serial.print("WiFi");
  WiFi.begin("Wokwi-GUEST", "", 6);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println(" connected");
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String clientId = String("aegis-") + METER_ID + "-" + String((uint32_t)esp_random(), HEX);
    Serial.printf("MQTT %s ... ", MQTT_HOST);
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("connected");
      mqtt.subscribe(T_CMD.c_str());
      publishGrid(outageNow());
    } else {
      Serial.printf("failed rc=%d, retry\n", mqtt.state());
      delay(1000);
    }
  }
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  pinMode(GRID_SWITCH_PIN, INPUT_PULLUP);
  pinMode(LED_CHARGE, OUTPUT);
  pinMode(LED_EXPORT, OUTPUT);
  pinMode(LED_OUTAGE, OUTPUT);
  Serial.println("AEGIS-GRID SELLER METER " METER_ID " - SIMULATION ONLY");

  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(768);
  mqtt.setCallback(onMessage);
  connectMqtt();
  lastStepMs = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  unsigned long now = millis();
  float dtH = (now - lastStepMs) / 3600000.0f * TIME_SCALE;
  simMinutes += (now - lastStepMs) / 60000.0 * TIME_SCALE;
  lastStepMs = now;

  lastPvW = analogRead(PV_PIN) * MAX_PV_W / 4095.0f;
  lastLoadW = analogRead(LOAD_PIN) * MAX_LOAD_W / 4095.0f;
  bool outage = outageNow();

  lastStep = model.step(lastPvW, lastLoadW, outage, dtH);
  if (lastStep.stop != aegis::StopReason::None) publishFinal(lastStep.stop);

  if (outage != lastOutage || now - lastGridMs >= 10000) {
    lastOutage = outage;
    lastGridMs = now;
    publishGrid(outage);
  }
  if (model.trading() && now - lastLineMs >= 250) {
    lastLineMs = now;
    publishLine();
  }
  if (now - lastTelemetryMs >= 1000) {
    lastTelemetryMs = now;
    publishTelemetry(outage);
  }

  digitalWrite(LED_CHARGE, lastStep.chargeW > 0.1f);
  digitalWrite(LED_EXPORT, lastStep.exportW > 0.1f);
  digitalWrite(LED_OUTAGE, outage);
  delay(20);
}
