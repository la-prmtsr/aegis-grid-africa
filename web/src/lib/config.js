// Settings for the browser. Values come from web/.env (VITE_*), see .env.example.
// Topic names mirror bridge/src/config.js and docs/data-format.md: keep them in sync.

const env = import.meta.env;

export const SITE = env.VITE_SITE || 'ag-sakarya26';
export const MQTT_WS_URL = env.VITE_MQTT_WS_URL || 'wss://broker.hivemq.com:8884/mqtt';

// v2: same root as Faras's Wokwi Stage 4E and Unity (docs/integration-v2.md)
export const P = `aegis-grid/${SITE}/`;
export const topics = {
  grid: `${P}grid`,
  telemetry: (meterId) => `${P}meter/${meterId}/telemetry`,
  telemetryAll: `${P}meter/+/telemetry`,
  readingAll: `${P}trade/+/reading/+`,
  appRequest: `${P}app/request`, // Buyer Request -> backend relayer
  appDemo: `${P}app/demo`, // demo controls: outage, daylight, tamper, shop load
  backendStatus: `${P}backend/status`, // relayer status (retained)
};

export const METER = { seller: 'METER_A', buyer: 'METER_B' };

export const CHAIN = {
  rpcUrl: env.VITE_RPC_URL || 'https://sepolia.base.org',
  chainId: Number(env.VITE_CHAIN_ID || 84532),
  escrow: env.VITE_ESCROW_ADDRESS || '0x918ad58816c6d09137eB4075c2BA5c3e56aC4f6a',
  deployBlock: Number(env.VITE_DEPLOY_BLOCK || 48200239),
  explorer: (env.VITE_EXPLORER_URL || 'https://base-sepolia.blockscout.com').replace(/\/$/, ''),
};

// Demo accounts (public addresses from docs/evidence.md). Display names match the landing story.
export const ACCOUNTS = {
  seller: { address: env.VITE_SELLER_ADDRESS || '0x66b9Cd34A3D306Eb89F0d7FcF528A101D22D6B49', name: 'Seller A', label: 'Household A · battery owner', meterId: METER.seller },
  buyer: { address: env.VITE_BUYER_ADDRESS || '0xA9Cbb353E5Cb00413f3CD6BfaB3d11121245610F', name: 'Buyer B', label: 'Household B · shop', meterId: METER.buyer },
  utility: { address: env.VITE_UTILITY_ADDRESS || '0xC25b2acf83FaE9434Ecf09FF7C692b786906450F', name: 'Utility' },
  platform: { address: env.VITE_PLATFORM_ADDRESS || '0xdd33958c0f6a2f647Bcc1Fd989305D4824541D15', name: 'Aegis platform' },
};

// Impact conversion (README "Impact method"). These are ASSUMPTIONS until the team cites sources.
export const IMPACT = {
  dieselLPerKWh: Number(env.VITE_DIESEL_L_PER_KWH || 0.3),
  co2KgPerL: Number(env.VITE_CO2_KG_PER_L || 2.68),
};

// Mobile money layer. SIMULATED in this prototype: no MTN MoMo API is called and no real money moves.
// Amounts in US dollars are derived from on-chain energy (Wh) with a fixed demo price per kWh. Default $0.30/kWh,
// set between the two prices a Ghanaian shop compares (October 2026, about GH₵12.25 per US$):
//   grid: PURC non-residential tariff GH₵1.84/kWh (0–300 kWh, from 1 July 2026) = about $0.15/kWh, so a battery owner
//         earns about twice the grid price for stored solar;
//   diesel generator: about GH₵19.30/L = $1.58/L × IMPACT.dieselLPerKWh (0.3 L/kWh) = about $0.47/kWh, so the shop
//         pays about a third less than running a generator.
// Demo energy scale: the Wokwi meters measure a small model (an order is 10-100 Wh), a real shop uses 1-10 kWh in one
// load-shedding block. Money is priced on the real-world energy: 1 Wh measured = demoScale Wh at a real shop (default
// 100, so 20 Wh = 2 kWh = $0.60). The chain, the receipts' meter readings and the 3% check keep the measured Wh.
export const MOMO = {
  demoScale: Number(env.VITE_DEMO_ENERGY_SCALE || 100),
  currency: '$',
  pricePerKWh: Number(env.VITE_P2P_USD_PER_KWH || 0.3), // P2P demo price in US$ per kWh (assumption, see above)
  dieselPerL: Number(env.VITE_DIESEL_USD_PER_L || 1.58), // US$ per litre of diesel, for the "saved vs a generator" line
  tradeMaxWh: Number(env.VITE_TRADE_MAX_WH || 500), // must match TRADE_MAX_WH of the bridge (default 500)
  buyerPhone: env.VITE_BUYER_MOMO || '+233 24 ··· 1187',
  sellerPhone: env.VITE_SELLER_MOMO || '+233 55 ··· 0420',
};

export const txUrl = (hash) => `${CHAIN.explorer}/tx/${hash}`;
export const addrUrl = (addr) => `${CHAIN.explorer}/address/${addr}`;

// Operator sign-in (auth.html#operator): one fixed account for the Aegis team, no sign up. Only a SHA-256 hash of
// "username:password" is in the code, never the credentials themselves; the team keeps them privately.
// New credentials: `npm run operator-hash -- <username> <password>` and put the result in VITE_OPERATOR_HASH.
// PROTOTYPE: the check runs in the browser, so this hides the operator console, it is not server-side access control.
export const OPERATOR_HASH = (env.VITE_OPERATOR_HASH || 'a7e82857d7bfc71de87972023f59930963e975b95ee6dddb5f972ad4ba321dbd').toLowerCase();
