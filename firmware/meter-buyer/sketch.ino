// Aegis-Grid Africa - Buyer smart meter (METER_B), Wokwi simulation.
// Shop meter: requests clean power during load shedding and records the energy that arrives.
// SIMULATION ONLY: a potentiometer stands in for the shop load, MQTT stands in for the cable.
// Data format: docs/data-format.md (v1).

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "buyer_model.h"

// ---------------------------------------------------------------- settings
#define SITE "ag-demo"                 // CHANGE to your team id, same everywhere (see docs)
#define METER_ID "METER_B"
#define LINE_ID "L1"
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const float TIME_SCALE = 60.0f;        // must match the seller meter

const int LOAD_PIN = 34;               // potentiometer: shop load (lights, fridge)
const int REQUEST_BTN_PIN = 19;        // push button: "Request Clean Power" (toggles)
const int TAMPER_SWITCH_PIN = 18;      // slide switch: tamper the meter (fraud demo)
const int LED_REQUEST = 25;            // blue: request active
const int LED_RECEIVING = 26;          // green: receiving P2P energy
const int LED_OUTAGE = 27;             // red: grid outage

const float MAX_LOAD_W = 600.0f;

// ---------------------------------------------------------------- topics
const String P = String("aegisgrid/") + SITE + "/";
const String T_TELEMETRY = P + "meter/" METER_ID "/telemetry";
const String T_CMD = P + "meter/" METER_ID "/cmd";
const String T_GRID = P + "grid";
const String T_LINE = P + "line/" LINE_ID;

WiFiClient net;
PubSubClient mqtt(net);
aegis::BuyerModel model;

bool outage = false;
bool requesting = false;
bool lastBtn = HIGH;
unsigned long lastBtnChangeMs = 0;
unsigned long lastStepMs = 0, lastTelemetryMs = 0;
uint32_t seq = 0;
double simMinutes = 0;
float lastLoadW = 0;
aegis::BuyerStep lastStep;

// ---------------------------------------------------------------- helpers
const char* statusName() {
  if (lastStep.importW > 1.0f) return "RECEIVING";
  if (requesting && outage) return model.trading() ? "NO_SUPPLY" : "REQUESTING";
  if (requesting) return "REQUESTING";
  return outage ? "NO_SUPPLY" : "IDLE_GRID";
}

void publishTelemetry() {
  JsonDocument d;
  d["v"] = 1;
  d["meterId"] = METER_ID;
  d["role"] = "buyer";
  d["seq"] = seq++;
  d["simMin"] = serialized(String(simMinutes, 1));
  d["timeScale"] = TIME_SCALE;
  d["grid"] = outage ? "OUTAGE" : "AVAILABLE";
  d["loadW"] = serialized(String(lastLoadW, 1));
  d["importW"] = serialized(String(lastStep.importW, 1));
  d["unservedW"] = serialized(String(lastStep.unservedW, 1));
  d["requesting"] = requesting;
  d["tamper"] = model.tamper;
  d["tradeId"] = model.tradeId;
  d["tradeWh"] = serialized(String(model.reportedWh, 1));
  d["importWhTotal"] = (uint32_t)model.importWhTotal;
  d["status"] = statusName();
  d["simulated"] = true;
  char buf[512];
  size_t n = serializeJson(d, buf);
  mqtt.publish(T_TELEMETRY.c_str(), (const uint8_t*)buf, n);
  Serial.println(buf);
}

void publishFinal() {
  if (!model.trading()) return;
  JsonDocument d;
  d["v"] = 1;
  d["tradeId"] = model.tradeId;
  d["role"] = "buyer";
  d["meterId"] = METER_ID;
  d["wh"] = (uint32_t)model.reportedWh;       // integer, rounded down
  d["tamper"] = model.tamper;
  d["reason"] = "stop_cmd";
  d["simulated"] = true;
  char buf[200];
  size_t n = serializeJson(d, buf);
  String topic = P + "trade/" + String(model.tradeId) + "/reading/buyer";
  mqtt.publish(topic.c_str(), (const uint8_t*)buf, n, true);  // retained
  Serial.printf("FINAL buyer trade=%lu wh=%lu tamper=%d\n", (unsigned long)model.tradeId,
                (unsigned long)model.reportedWh, model.tamper);
  model.endTrade();
}

void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument d;
  if (deserializeJson(d, payload, len)) return;

  if (T_GRID == topic) {
    outage = strcmp(d["status"] | "AVAILABLE", "OUTAGE") == 0;
  } else if (T_LINE == topic) {
    model.onLine(d["tradeId"] | 0, d["whSent"] | 0.0f);
  } else if (T_CMD == topic) {
    const char* cmd = d["cmd"] | "";
    uint32_t id = d["tradeId"] | 0;
    if (strcmp(cmd, "start") == 0 && id != 0) {
      if (model.trading() && model.tradeId != id) publishFinal();
      model.startTrade(id);
      Serial.printf("START trade=%lu\n", (unsigned long)id);
    } else if (strcmp(cmd, "stop") == 0 && id == model.tradeId && model.trading()) {
      publishFinal();
    }
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
      mqtt.subscribe(T_GRID.c_str());
      mqtt.subscribe(T_LINE.c_str());
    } else {
      Serial.printf("failed rc=%d, retry\n", mqtt.state());
      delay(1000);
    }
  }
}

// ---------------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);
  pinMode(REQUEST_BTN_PIN, INPUT_PULLUP);
  pinMode(TAMPER_SWITCH_PIN, INPUT_PULLUP);
  pinMode(LED_REQUEST, OUTPUT);
  pinMode(LED_RECEIVING, OUTPUT);
  pinMode(LED_OUTAGE, OUTPUT);
  Serial.println("AEGIS-GRID BUYER METER " METER_ID " - SIMULATION ONLY");

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

  // Request button toggles on each press (debounced).
  bool btn = digitalRead(REQUEST_BTN_PIN);
  if (btn != lastBtn && now - lastBtnChangeMs > 50) {
    lastBtnChangeMs = now;
    lastBtn = btn;
    if (btn == LOW) {
      requesting = !requesting;
      publishTelemetry();  // tell the bridge immediately
    }
  }
  model.tamper = digitalRead(TAMPER_SWITCH_PIN) == LOW;

  float dtH = (now - lastStepMs) / 3600000.0f * TIME_SCALE;
  simMinutes += (now - lastStepMs) / 60000.0 * TIME_SCALE;
  lastStepMs = now;

  lastLoadW = analogRead(LOAD_PIN) * MAX_LOAD_W / 4095.0f;
  lastStep = model.step(lastLoadW, outage, dtH);

  if (now - lastTelemetryMs >= 1000) {
    lastTelemetryMs = now;
    publishTelemetry();
  }

  digitalWrite(LED_REQUEST, requesting);
  digitalWrite(LED_RECEIVING, lastStep.importW > 1.0f);
  digitalWrite(LED_OUTAGE, outage);
  delay(20);
}
