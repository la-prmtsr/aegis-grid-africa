// Mock meters: METER_A (seller) and METER_B (buyer) speaking data format v1 (docs/data-format.md).
// Use them to build the bridge and the dashboard without Wokwi running.
//
//   npm run meters                  both meters
//   npm run meters -- --only seller just the seller (e.g. with the Wokwi buyer)
//   npm run meters -- --only buyer  just the buyer
//
// Keyboard (when run in a terminal): d = day/night, o = grid outage, r = request clean power,
// t = tamper buyer meter, + / - = shop load, q = quit.
// Remote control (e.g. scenario buttons on the dashboard): publish JSON to aegisgrid/<SITE>/sim/control
//   { "outage": true, "requesting": true, "tamper": false, "pvW": 0, "sellerLoadW": 80, "shopLoadW": 300 }

import mqtt from 'mqtt';
import { MQTT_URL, SITE, TIME_SCALE, topics, r1 } from './config.js';
import { SellerModel, BuyerModel } from './models.js';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const runSeller = only !== 'buyer';
const runBuyer = only !== 'seller';

// Simulated inputs (what the potentiometers, switch and button do in Wokwi)
const inputs = { pvW: 800, sellerLoadW: 80, shopLoadW: 300, outage: false, requesting: false, tamper: false };

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function connect(name) {
  const c = mqtt.connect(MQTT_URL, { clientId: `aegis-mock-${name}-${Math.random().toString(16).slice(2, 8)}` });
  c.on('error', (e) => log(`[${name}] MQTT error`, e.message));
  return c;
}

// ------------------------------------------------------------------ seller
function startSeller() {
  const id = 'METER_A';
  const model = new SellerModel();
  const c = connect('seller');
  let seq = 0;
  let simMin = 0;
  let last = { chargeW: 0, curtailedW: 0, dischargeLocalW: 0, exportW: 0 };
  let lastOutage = null;

  const publishLine = () =>
    c.publish(topics.line, JSON.stringify({ tradeId: model.tradeId, whSent: Math.round(model.tradeWh * 100) / 100, w: r1(last.exportW) }));

  const publishFinal = (reason) => {
    if (!model.trading) return;
    publishLine();
    const msg = {
      v: 1, tradeId: model.tradeId, role: 'seller', meterId: id,
      wh: Math.floor(model.tradeWh), socBpsAfter: model.socBps, reason, simulated: true,
    };
    c.publish(topics.reading(model.tradeId, 'seller'), JSON.stringify(msg), { retain: true });
    log('[seller] FINAL', JSON.stringify(msg));
    model.endTrade();
  };

  const publishGrid = () =>
    c.publish(topics.grid, JSON.stringify({ v: 1, status: inputs.outage ? 'OUTAGE' : 'AVAILABLE', source: id, simulated: true }), { retain: true });

  c.on('connect', () => {
    log(`[seller] connected to ${MQTT_URL} site=${SITE}`);
    c.subscribe(topics.cmd(id));
    publishGrid();
  });

  c.on('message', (_t, buf) => {
    let d;
    try { d = JSON.parse(buf.toString()); } catch { return; }
    const tid = Number(d.tradeId ?? 0);
    if (d.cmd === 'start' && tid) {
      if (model.trading && model.tradeId !== tid) publishFinal('stop_cmd');
      model.startTrade(tid, Number(d.maxWh ?? 0), Number(d.targetW ?? 250));
      log(`[seller] START trade=${tid} maxWh=${model.maxWh} targetW=${model.targetW}`);
    } else if (d.cmd === 'target' && model.trading && tid === model.tradeId) {
      model.targetW = Number(d.targetW ?? model.targetW);
    } else if (d.cmd === 'stop' && model.trading && tid === model.tradeId) {
      publishFinal('stop_cmd');
    }
  });

  const status = () => {
    if (model.trading && !inputs.outage) return 'WAIT_OUTAGE';
    if (last.exportW > 0.1) return 'EXPORTING';
    if (inputs.outage) return model.soc <= model.cfg.minSoc + 0.005 ? 'SOC_FLOOR' : 'ISLAND';
    if (last.chargeW > 0.1) return 'CHARGING';
    if (last.curtailedW > 0.1) return 'BATTERY_FULL';
    return 'IDLE_GRID';
  };

  let t0 = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dtH = ((now - t0) / 3_600_000) * TIME_SCALE;
    simMin += ((now - t0) / 60_000) * TIME_SCALE;
    t0 = now;
    last = model.step(inputs.pvW, inputs.sellerLoadW, inputs.outage, dtH);
    if (last.stop) publishFinal(last.stop);
    if (inputs.outage !== lastOutage) {
      lastOutage = inputs.outage;
      if (c.connected) publishGrid();
    }
  }, 50);

  setInterval(() => { if (model.trading) publishLine(); }, 250);
  setInterval(publishGrid, 10_000);
  setInterval(() => {
    c.publish(topics.telemetry(id), JSON.stringify({
      v: 1, meterId: id, role: 'seller', seq: seq++, simMin: r1(simMin), timeScale: TIME_SCALE,
      grid: inputs.outage ? 'OUTAGE' : 'AVAILABLE',
      pvW: r1(inputs.pvW), loadW: r1(inputs.sellerLoadW),
      chargeW: r1(last.chargeW), curtailedW: r1(last.curtailedW),
      dischargeLocalW: r1(last.dischargeLocalW), exportW: r1(last.exportW),
      batteryWh: r1(model.batteryWh), socBps: model.socBps,
      tradeId: model.tradeId, tradeWh: r1(model.tradeWh), exportWhTotal: Math.floor(model.exportWhTotal),
      status: status(), simulated: true,
    }));
  }, 1000);
  return c;
}

// ------------------------------------------------------------------- buyer
function startBuyer() {
  const id = 'METER_B';
  const model = new BuyerModel();
  const c = connect('buyer');
  let seq = 0;
  let simMin = 0;
  let last = { importW: 0, unservedW: 0 };
  let gridOutage = false; // what this meter heard on the grid topic

  const publishFinal = () => {
    if (!model.trading) return;
    const msg = {
      v: 1, tradeId: model.tradeId, role: 'buyer', meterId: id,
      wh: Math.floor(model.reportedWh), tamper: model.tamper, reason: 'stop_cmd', simulated: true,
    };
    c.publish(topics.reading(model.tradeId, 'buyer'), JSON.stringify(msg), { retain: true });
    log('[buyer]  FINAL', JSON.stringify(msg));
    model.endTrade();
  };

  const status = () => {
    if (last.importW > 1) return 'RECEIVING';
    if (inputs.requesting && gridOutage) return model.trading ? 'NO_SUPPLY' : 'REQUESTING';
    if (inputs.requesting) return 'REQUESTING';
    return gridOutage ? 'NO_SUPPLY' : 'IDLE_GRID';
  };

  const publishTelemetry = () =>
    c.publish(topics.telemetry(id), JSON.stringify({
      v: 1, meterId: id, role: 'buyer', seq: seq++, simMin: r1(simMin), timeScale: TIME_SCALE,
      grid: gridOutage ? 'OUTAGE' : 'AVAILABLE',
      loadW: r1(inputs.shopLoadW), importW: r1(last.importW), unservedW: r1(last.unservedW),
      requesting: inputs.requesting, tamper: model.tamper,
      tradeId: model.tradeId, tradeWh: r1(model.reportedWh), importWhTotal: Math.floor(model.importWhTotal),
      status: status(), simulated: true,
    }));

  c.on('connect', () => {
    log(`[buyer]  connected to ${MQTT_URL} site=${SITE}`);
    c.subscribe([topics.cmd(id), topics.grid, topics.line]);
  });

  c.on('message', (topic, buf) => {
    let d;
    try { d = JSON.parse(buf.toString()); } catch { return; }
    if (topic === topics.grid) {
      gridOutage = d.status === 'OUTAGE';
    } else if (topic === topics.line) {
      model.onLine(Number(d.tradeId ?? 0), Number(d.whSent ?? 0));
    } else if (topic === topics.cmd(id)) {
      const tid = Number(d.tradeId ?? 0);
      if (d.cmd === 'start' && tid) {
        if (model.trading && model.tradeId !== tid) publishFinal();
        model.startTrade(tid);
        log(`[buyer]  START trade=${tid}`);
      } else if (d.cmd === 'stop' && model.trading && tid === model.tradeId) {
        publishFinal();
      }
    }
  });

  let t0 = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dtH = ((now - t0) / 3_600_000) * TIME_SCALE;
    simMin += ((now - t0) / 60_000) * TIME_SCALE;
    t0 = now;
    model.tamper = inputs.tamper;
    last = model.step(inputs.shopLoadW, gridOutage, dtH);
  }, 50);
  setInterval(publishTelemetry, 1000);
  return { client: c, publishTelemetry };
}

// --------------------------------------------------------------- controls
const seller = runSeller ? startSeller() : null;
const buyer = runBuyer ? startBuyer() : null;

function apply(patch, source) {
  const before = inputs.requesting;
  for (const k of Object.keys(inputs)) if (k in patch) inputs[k] = typeof inputs[k] === 'boolean' ? Boolean(patch[k]) : Number(patch[k]);
  log(`[control:${source}]`, JSON.stringify(inputs));
  if (buyer && before !== inputs.requesting) buyer.publishTelemetry(); // tell the bridge at once
}

// Remote control over MQTT
const ctl = connect('control');
ctl.on('connect', () => ctl.subscribe(topics.simControl));
ctl.on('message', (_t, buf) => {
  try { apply(JSON.parse(buf.toString()), 'mqtt'); } catch { /* ignore bad json */ }
});

// Keyboard
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (k) => {
    if (k === 'q' || k === '\u0003') process.exit(0);
    if (k === 'd') apply({ pvW: inputs.pvW > 0 ? 0 : 800 }, 'key');
    if (k === 'o') apply({ outage: !inputs.outage }, 'key');
    if (k === 'r') apply({ requesting: !inputs.requesting }, 'key');
    if (k === 't') apply({ tamper: !inputs.tamper }, 'key');
    if (k === '+') apply({ shopLoadW: Math.min(600, inputs.shopLoadW + 50) }, 'key');
    if (k === '-') apply({ shopLoadW: Math.max(0, inputs.shopLoadW - 50) }, 'key');
  });
  log('keys: d=day/night o=outage r=request t=tamper +/-=shop load q=quit');
}
log(`mock meters running (${[runSeller && 'seller', runBuyer && 'buyer'].filter(Boolean).join(' + ')}), timeScale=${TIME_SCALE}`);
void seller;
