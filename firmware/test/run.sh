#!/usr/bin/env bash
# Host test: compiles both Wokwi sketches against small Arduino/WiFi/MQTT stubs and runs a
# day -> outage -> honest trade -> tampered trade -> battery-floor scenario.
# Needs g++ (C++17) and curl. Linux, macOS, or WSL/Git Bash on Windows.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ext build
if [ ! -f ext/ArduinoJson.h ]; then
  curl -sSL -o ext/ArduinoJson.h \
    https://github.com/bblanchon/ArduinoJson/releases/download/v7.4.2/ArduinoJson-v7.4.2.h
fi
g++ -std=c++17 -Wall -Wno-unused-variable -Wno-unused-function \
  -I stubs -I ext -I ../meter-seller -I ../meter-buyer \
  -x c++ host_scenario.cpp -o build/host_scenario
./build/host_scenario
