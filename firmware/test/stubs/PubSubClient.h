#pragma once
#include "Arduino.h"
#include <functional>
#include <vector>
#include <map>
#include <string>
struct Msg { std::string topic, payload; bool retained; };
struct PubSubClient;
extern std::vector<PubSubClient*> g_clients;
extern std::vector<Msg> g_log;
extern std::map<std::string, std::string> g_retained;
void bus_publish(const std::string& t, const std::string& p, bool r);
struct PubSubClient {
  std::vector<std::string> subs;
  void (*cb)(char*, byte*, unsigned int) = nullptr;
  std::vector<Msg> inbox;
  bool conn = false;
  PubSubClient(WiFiClient&) { g_clients.push_back(this); }
  void setServer(const char*, uint16_t) {}
  void setBufferSize(uint16_t) {}
  void setCallback(void (*c)(char*, byte*, unsigned int)) { cb = c; }
  bool connect(const char*) { conn = true; return true; }
  bool connected() { return conn; }
  int state() { return 0; }
  void subscribe(const char* t) {
    subs.push_back(t);
    auto it = g_retained.find(t);
    if (it != g_retained.end()) inbox.push_back({t, it->second, true});
  }
  bool publish(const char* t, const uint8_t* p, unsigned n, bool r = false) {
    bus_publish(t, std::string((const char*)p, n), r); return true;
  }
  bool publish(const char* t, const char* p) { bus_publish(t, p, false); return true; }
  void loop() {
    auto msgs = inbox; inbox.clear();
    for (auto& m : msgs) { std::string t = m.topic; cb(&t[0], (byte*)m.payload.data(), m.payload.size()); }
  }
};
