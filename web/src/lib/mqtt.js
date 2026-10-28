// Live meter data over MQTT (WebSocket), following docs/data-format.md v1.
import mqtt from 'mqtt';
import { MQTT_WS_URL, SITE, topics, METER } from './config.js';
import { state, update } from './store.js';

let client = null;
const HISTORY_MAX = 300; // ~5 minutes at 1 Hz

export function startMqtt() {
  client = mqtt.connect(MQTT_WS_URL, {
    clientId: `aegis-web-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 3000,
    connectTimeout: 8000,
  });

  client.on('connect', () => {
    update({ mqtt: 'online' });
    client.subscribe([topics.grid, topics.telemetryAll, topics.readingAll]);
  });
  client.on('reconnect', () => update({ mqtt: 'connecting' }));
  client.on('offline', () => update({ mqtt: 'offline' }));
  client.on('close', () => { if (state.mqtt !== 'connecting') update({ mqtt: 'offline' }); });
  client.on('error', () => update({ mqtt: 'offline' }));

  client.on('message', (topic, payload) => {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch { return; }

    if (topic === topics.grid) {
      update({ grid: msg.status === 'OUTAGE' ? 'OUTAGE' : 'AVAILABLE' });
    } else if (topic === topics.telemetry(METER.seller)) {
      onSeller(msg);
    } else if (topic === topics.telemetry(METER.buyer)) {
      state.lastSeen[METER.buyer] = Date.now();
      update({ buyer: msg, grid: state.grid ?? msg.grid });
      pushSample();
    } else if (topic.includes('/reading/')) {
      const id = Number(msg.tradeId);
      if (!id || (msg.role !== 'seller' && msg.role !== 'buyer')) return;
      const r = { ...(state.readings[id] || {}) };
      r[msg.role] = msg;
      update({ readings: { ...state.readings, [id]: r } });
    }
  });
}

function onSeller(msg) {
  const prev = state.seller;
  state.lastSeen[METER.seller] = Date.now();
  // integrate curtailed solar (W over simulated time) for the "wasted energy absorbed" view
  if (prev && msg.simMin > prev.simMin) {
    const dtH = (msg.simMin - prev.simMin) / 60;
    if (dtH < 1) state.curtailedWhSession += (Number(prev.curtailedW) || 0) * dtH;
  }
  update({ seller: msg, grid: state.grid ?? msg.grid });
  pushSample();
}

let lastSample = 0;
function pushSample() {
  const now = Date.now();
  if (now - lastSample < 900) return;
  lastSample = now;
  const s = state.seller || {}, b = state.buyer || {};
  state.history.push({
    t: now, simMin: s.simMin ?? b.simMin,
    pvW: +s.pvW || 0, chargeW: +s.chargeW || 0, exportW: +s.exportW || 0, curtailedW: +s.curtailedW || 0,
    importW: +b.importW || 0, unservedW: +b.unservedW || 0, outage: state.grid === 'OUTAGE',
  });
  if (state.history.length > HISTORY_MAX) state.history.shift();
}

/** Is a meter sending telemetry right now? */
export const meterOnline = (id) => Date.now() - (state.lastSeen[id] || 0) < 5000;

/**
 * Demo control for the mock meters (tools/sim/mock-meters.js listens on sim/control).
 * Fields: outage, requesting, tamper (booleans), pvW, sellerLoadW, shopLoadW (numbers).
 * The Wokwi meters do not listen here: with Wokwi use the switch and button in the simulation.
 */
export function simControl(patch) {
  if (!client || !client.connected) return false;
  client.publish(topics.simControl, JSON.stringify(patch));
  return true;
}

export const site = SITE;
