// Mock of Faras's Wokwi Stage 4E meter, for development when the real Wokwi is not running.
// Publishes the same JSON fields on the same topic (aegis-grid/<site>/demo/telemetry) and follows the
// same policies: PCC opens during an outage, buyer first, community load only with emergency backup,
// 5% battery reserve. NEVER run it at the same time as the real Wokwi on the same broker.
//
// Keys: d day/night · o outage · r buyer button · b emergency backup · + / - shop load · q quit
// It also obeys aegis-grid/<site>/demo/control/# (any JSON with buyer_request, grid_status or
// emergency_backup_allowed) and the dashboard's app/demo topic (pvW, shopLoadW, communityLoadW, outage, backup).
import { SITE, SIM, topics } from './config.js';
import { connect, logger } from './mqtt.js';

const log = logger('mock-wokwi');
const CAP_WH = 1000;
const MAX_W = 500;
const EFF = 0.95;
const r1 = (x) => Math.round(x * 10) / 10;

const inp = { pvW: 900, communityLoadW: 300, shopLoadW: 250, outage: false, buyerRequest: false, backup: false };
let batteryWh = CAP_WH * 0.5;

const { publish } = connect('mock-wokwi', [`${topics.wokwiControl('#')}`, topics.appDemo], (topic, msg) => {
  const patch = {};
  if ('buyer_request' in msg) patch.buyerRequest = Boolean(msg.buyer_request);
  if ('grid_status' in msg) patch.outage = msg.grid_status === 'OUTAGE';
  if ('emergency_backup_allowed' in msg) patch.backup = Boolean(msg.emergency_backup_allowed);
  if (topic === topics.appDemo) {
    if (typeof msg.outage === 'boolean') patch.outage = msg.outage;
    if (typeof msg.backup === 'boolean') patch.backup = msg.backup;
    if (Number.isFinite(msg.pvW)) patch.pvW = msg.pvW;
    if (Number.isFinite(msg.shopLoadW)) patch.shopLoadW = msg.shopLoadW;
    if (Number.isFinite(msg.communityLoadW)) patch.communityLoadW = msg.communityLoadW;
  }
  if (Object.keys(patch).length) set(patch, topic.endsWith('/app/demo') ? 'app' : 'control');
}, log);

function set(patch, source) {
  Object.assign(inp, patch);
  log(`[${source}] ${JSON.stringify(inp)}`);
}

let last = Date.now();
function step() {
  const now = Date.now();
  const dtH = ((now - last) / 3_600_000) * SIM.timeScale;
  last = now;

  const buyerDemand = inp.buyerRequest ? inp.shopLoadW : 0;
  const demand = inp.communityLoadW + buyerDemand;
  const minWh = (SIM.minSocPct / 100) * CAP_WH;
  let charge = 0, discharge = 0, pvDelivered = 0, gridImport = 0, unserved = 0;

  if (!inp.outage) {
    const surplus = Math.max(0, inp.pvW - demand);
    const headroomW = dtH > 0 ? Math.max(0, (CAP_WH - batteryWh) / (EFF * dtH)) : 0;
    charge = Math.min(surplus, MAX_W, headroomW);
    pvDelivered = Math.min(inp.pvW, demand + charge);
    gridImport = Math.max(0, demand - inp.pvW);
  } else {
    // PCC open: solar and grid are isolated; the battery serves the buyer first.
    const availW = dtH > 0 ? Math.max(0, ((batteryWh - minWh) * EFF) / dtH) : 0;
    let budget = Math.min(MAX_W, availW);
    const toBuyer = Math.min(buyerDemand, budget);
    budget -= toBuyer;
    const toCommunity = inp.backup ? Math.min(inp.communityLoadW, budget) : 0;
    discharge = toBuyer + toCommunity;
    unserved = demand - discharge;
  }
  batteryWh += (charge * EFF - discharge / EFF) * dtH;
  batteryWh = Math.min(CAP_WH, Math.max(minWh, batteryWh));
  const soc = (100 * batteryWh) / CAP_WH;

  const energyStatus = !inp.outage
    ? inp.buyerRequest ? 'REQUEST_PENDING' : 'GRID_NORMAL'
    : unserved > 0.1 && (inp.buyerRequest && discharge + 0.1 < buyerDemand) ? 'ENERGY_SHORTAGE'
    : inp.buyerRequest ? 'EMERGENCY_SUPPLY_OK' : 'ISLAND_MODE';

  publish(topics.wokwiTelemetry, {
    site: SITE,
    meter_id: 'METER_A',
    pv_power_w: r1(inp.pvW),
    local_load_w: r1(inp.communityLoadW),
    buyer_request: inp.buyerRequest,
    buyer_demand_w: r1(buyerDemand),
    grid_status: inp.outage ? 'OUTAGE' : 'AVAILABLE',
    total_demand_w: r1(demand),
    battery_charge_w: r1(charge),
    battery_discharge_w: r1(discharge),
    battery_energy_wh: Math.round(batteryWh * 100) / 100,
    battery_soc_pct: Math.round(soc * 100) / 100,
    grid_import_w: r1(gridImport),
    unserved_power_w: r1(unserved),
    battery_min_soc_pct: SIM.minSocPct,
    emergency_backup_allowed: inp.backup,
    pv_delivered_to_microgrid_w: r1(pvDelivered),
    energy_status: energyStatus,
  }, { qos: 0 });
}
setInterval(step, 1000);

if (process.stdin.isTTY && !process.env.AEGIS_NO_KEYS) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (k) => {
    if (k === 'q' || k === '\u0003') process.exit(0);
    if (k === 'd') set({ pvW: inp.pvW > 0 ? 0 : 900 }, 'key');
    if (k === 'o') set({ outage: !inp.outage }, 'key');
    if (k === 'r') set({ buyerRequest: !inp.buyerRequest }, 'key');
    if (k === 'b') set({ backup: !inp.backup }, 'key');
    if (k === '+') set({ shopLoadW: Math.min(500, inp.shopLoadW + 50) }, 'key');
    if (k === '-') set({ shopLoadW: Math.max(50, inp.shopLoadW - 50) }, 'key');
  });
  log('keys: d day/night, o outage, r buyer button, b emergency backup, +/- shop load, q quit');
}
log(`publishing Stage 4E telemetry on ${topics.wokwiTelemetry} (MOCK, time scale ${SIM.timeScale}x)`);
