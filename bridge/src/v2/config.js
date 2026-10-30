// Aegis-Grid v2 settings: Wokwi Stage 4E + Unity digital twin + dual-meter escrow.
// Protocol: docs/integration-v2.md. Values come from the .env file in the repository root.
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// run.js starts each process with only the keys it may hold, and sets AEGIS_ENV_FILTERED so the
// child does not read the full .env again.
if (!process.env.AEGIS_ENV_FILTERED) loadEnv({ path: path.join(here, '..', '..', '..', '.env'), quiet: true });

const env = process.env;
const num = (name, fallback) => {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
export function need(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

export const SITE = env.AEGIS_SITE || 'ag-sakarya26';
export const MQTT_URL = env.AEGIS_MQTT_URL || 'mqtt://broker.hivemq.com:1883';

// Everything lives under one root, the same one Faras's Wokwi and Unity use.
export const ROOT = `aegis-grid/${SITE}`;
export const topics = {
  // Faras's Stage 4E (unchanged): Wokwi publishes, Unity and the backend subscribe.
  wokwiTelemetry: `${ROOT}/demo/telemetry`,
  wokwiControl: (sub) => `${ROOT}/demo/control/${sub}`,
  // Backend v2 (Faras's "integration protocol v2" proposal), read by the dashboard.
  grid: `${ROOT}/grid`,
  telemetry: (meterId) => `${ROOT}/meter/${meterId}/telemetry`,
  cmd: (meterId) => `${ROOT}/meter/${meterId}/cmd`,
  reading: (tradeId, role) => `${ROOT}/trade/${tradeId}/reading/${role}`,
  readingAll: `${ROOT}/trade/+/reading/+`,
  backendStatus: `${ROOT}/backend/status`,
  // Faras's Stage 5B.2 firmware (two ESP32 in Wokwi): REMOTE mode, trade commands, unsigned final events.
  final: (meterId) => `${ROOT}/meter/${meterId}/final`,
  finalAll: `${ROOT}/meter/+/final`,
  tradeCmd: `${ROOT}/trade/cmd`,
  // The app (dashboard) talks to the backend here.
  appRequest: `${ROOT}/app/request`,
  appDemo: `${ROOT}/app/demo`,
};

export const METER = { seller: 'METER_A', buyer: 'METER_B' };

// Simulation and verification parameters (design parameters, not measurements).
export const SIM = {
  timeScale: num('AEGIS_TIME_SCALE', 60), // energy accounting: 1 real second = timeScale simulated seconds
  lineLoss: num('AEGIS_LINE_LOSS', 0.02), // assumed cable loss between the two meters
  tamperFactor: num('AEGIS_TAMPER_FACTOR', 0.6), // a tampered buyer meter reports this share
  maxGapS: num('AEGIS_MAX_GAP_S', 5), // no energy is invented across telemetry gaps longer than this
  minSocPct: num('AEGIS_MIN_SOC_PCT', 5), // battery reserve (must match the contract: 500 bps)
  toleranceBps: num('AEGIS_TOLERANCE_BPS', 300), // must match the contract's toleranceBps
};
if (SIM.lineLoss < 0 || SIM.lineLoss >= 1) throw new Error('AEGIS_LINE_LOSS must be between 0 and 1');
if (SIM.timeScale <= 0) throw new Error('AEGIS_TIME_SCALE must be positive');

// Stage 5B.3: where the trade evidence comes from, and whether the backend may settle on-chain.
const pick = (name, allowed, fallback) => {
  const v = (env[name] || fallback).trim().toLowerCase();
  if (!allowed.includes(v)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return v;
};
export const STAGE5B = {
  // wokwi-final: Faras's METER_A/METER_B final events (Stage 5B.2). gateway: the v2 gateways count the
  // energy themselves from Stage 4E telemetry (firmware without trade commands).
  evidence: pick('AEGIS_EVIDENCE', ['wokwi-final', 'gateway'], 'wokwi-final'),
  // off (default): verify only, never send settleTrade. testnet: Base Sepolia demo with test funds,
  // labelled SIMULATED_TESTNET_SETTLEMENT.
  settlementMode: pick('SETTLEMENT_MODE', ['off', 'testnet'], 'off'),
  minSettleWh: num('MIN_SETTLEMENT_WH', 5), // testnet only: below this the whole-Wh rounding hides the gap
  targetW: num('TRADE_TARGET_W', 500), // firmware accepts (0, 500] W
  // how fast METER_A's trade counter (p2p_trade_wh) runs: 1 = real time (5B.2 firmware), 60 = 1 s counts as 1 min.
  // Stage 6 sizes orders, the stop point and the escrow margin from it (sizing.js).
  energyScale: num('FIRMWARE_ENERGY_SCALE', 1),
  finalTimeoutS: num('FINAL_TIMEOUT_S', 30), // how long to wait for both finals after STOP
  modeTopic: env.WOKWI_MODE_TOPIC || 'mode', // relative to demo/control/
  modeRemote: env.WOKWI_MODE_REMOTE || '{"mode":"remote"}', // payload that puts METER_A in REMOTE mode
  statusPort: num('STATUS_API_PORT', 8790), // read-only trade status API on 127.0.0.1
  evidenceDir: env.EVIDENCE_DIR || path.join(here, '..', '..', 'data'),
};
if (!(STAGE5B.targetW > 0 && STAGE5B.targetW <= 500)) throw new Error('TRADE_TARGET_W must be in (0, 500]');

export const TRADE = {
  pricePerWh: BigInt(env.PRICE_WEI_PER_WH || '1000000000'), // 1 gwei per Wh (demo price)
  maxWh: BigInt(env.TRADE_MAX_WH || '500'),
  durationS: BigInt(env.TRADE_DURATION_S || '3600'),
};

// Commands to Faras's Wokwi in REMOTE mode. Leave a topic empty until the format is confirmed:
// the backend then only logs what it would send. Topics are relative to <ROOT>/demo/control/.
// Switches use _ON/_OFF payloads; setpoints (PV, LOAD) use a _VALUE template with {value} in watts.
const ctrl = (key) => ({
  topic: env[`WOKWI_CTRL_${key}_TOPIC`] || '',
  on: env[`WOKWI_CTRL_${key}_ON`] || '',
  off: env[`WOKWI_CTRL_${key}_OFF`] || '',
  value: env[`WOKWI_CTRL_${key}_VALUE`] || '',
});
/** A control with a confirmed default format: used when .env leaves it empty; WOKWI_CTRL_<KEY>_TOPIC=none turns it off. */
const ctrlDefault = (key, def) => {
  const c = ctrl(key);
  if (c.topic === 'none') return { ...c, topic: '' };
  return c.topic ? c : { ...c, ...def };
};
export const WOKWI_CONTROL = {
  buyer: ctrl('BUYER'), outage: ctrl('OUTAGE'), backup: ctrl('BACKUP'), pv: ctrl('PV'), load: ctrl('LOAD'),
  // Stage 5B: tamper switch of Faras's METER_B firmware (the backend itself never alters a meter value).
  // Faras's firmware listens on demo/control/meter_b_tamper (1 / 0), so that is the default.
  tamper: ctrlDefault('TAMPER', { topic: 'meter_b_tamper', on: '1', off: '0' }),
};

// Chain settings are read lazily, so the monitoring parts run without a wallet.
export const chain = {
  get rpcUrl() { return need('BASE_SEPOLIA_RPC_URL'); },
  get escrow() { return need('ESCROW_V2_ADDRESS'); },
  get relayerKey() { return need('DEPLOYER_PRIVATE_KEY'); },
  get buyerKey() { return need('BUYER_PRIVATE_KEY'); },
  get sellerAddress() { return need('SELLER_ADDRESS'); },
  get buyerAddress() { return need('BUYER_ADDRESS'); },
  get sellerMeterKey() { return need('SELLER_METER_PRIVATE_KEY'); },
  get buyerMeterKey() { return need('BUYER_METER_PRIVATE_KEY'); },
};

export const EXPLORER = (env.EXPLORER_URL || 'https://base-sepolia.blockscout.com').replace(/\/$/, '');
