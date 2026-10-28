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
export const WOKWI_CONTROL = {
  buyer: ctrl('BUYER'), outage: ctrl('OUTAGE'), backup: ctrl('BACKUP'), pv: ctrl('PV'), load: ctrl('LOAD'),
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
