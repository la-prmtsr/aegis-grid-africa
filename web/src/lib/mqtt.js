// Live meter data over MQTT (WebSocket), following docs/integration-v2.md.
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
    client.subscribe([topics.grid, topics.telemetryAll, topics.readingAll, topics.backendStatus]);
  });
  client.on('reconnect', () => update({ mqtt: 'connecting' }));
  client.on('offline', () => update({ mqtt: 'offline' }));
  client.on('close', () => { if (state.mqtt !== 'connecting') update({ mqtt: 'offline' }); });
  client.on('error', () => update({ mqtt: 'offline' }));

  client.on('message', (topic, payload) => {
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch { return; }

    if (topic === topics.backendStatus) {
      update({ backend: msg });
    } else if (topic === topics.grid) {
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
 * Send a request or a demo control to the backend (v2).
 * - requesting -> app/request: the relayer opens the trade on-chain, then turns on the Wokwi buyer request.
 * - outage, tamper, pvW, shopLoadW -> app/demo: the relayer forwards outage to Wokwi (when configured),
 *   Meter B handles tamper, and the Wokwi mock (bridge/src/v2/mock-wokwi.js) obeys the rest.
 */
export function simControl(patch) {
  if (!client || !client.connected) return false;
  const { requesting, ...demo } = patch;
  if (typeof requesting === 'boolean') client.publish(topics.appRequest, JSON.stringify({ requesting }), { qos: 1 });
  if (Object.keys(demo).length) client.publish(topics.appDemo, JSON.stringify(demo), { qos: 1 });
  return true;
}

export const site = SITE;
