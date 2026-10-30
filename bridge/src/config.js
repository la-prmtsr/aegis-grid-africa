
// Reads settings from the .env file in the repository root (one folder up from bridge/).
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '..', '..', '.env'), quiet: true });

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

export const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://broker.hivemq.com:1883';
export const SITE = need('SITE');

export const P = `aegisgrid/${SITE}/`;
export const topics = {
  grid: `${P}grid`,
  telemetry: (meterId) => `${P}meter/${meterId}/telemetry`,
  telemetryAll: `${P}meter/+/telemetry`,
  cmd: (meterId) => `${P}meter/${meterId}/cmd`,
  reading: (tradeId, role) => `${P}trade/${tradeId}/reading/${role}`,
  readingAll: `${P}trade/+/reading/+`,
};

// Blockchain settings are only needed from Step 7 on, so they are read lazily.
export const chain = {
  get rpcUrl() { return need('BASE_SEPOLIA_RPC_URL'); },
  get escrow() { return need('ESCROW_ADDRESS'); },
  get relayerKey() { return need('DEPLOYER_PRIVATE_KEY'); },
  get buyerKey() { return need('BUYER_PRIVATE_KEY'); },
  get sellerAddress() { return need('SELLER_ADDRESS'); },
  get sellerMeterKey() { return need('SELLER_METER_PRIVATE_KEY'); },
  get buyerMeterKey() { return need('BUYER_METER_PRIVATE_KEY'); },
};

// Trade terms for the demo (design parameters, not market prices).
export const TRADE = {
  pricePerWh: BigInt(process.env.PRICE_WEI_PER_WH ?? '1000000000'), // 1 gwei per Wh
  maxWh: BigInt(process.env.TRADE_MAX_WH ?? '500'),
  durationS: BigInt(process.env.TRADE_DURATION_S ?? '3600'), // 1 hour (contract minimum is 10 minutes)
};