// Starts the v2 backend as separate processes, each with only the private key it is allowed to hold:
//   meter-a.js  SELLER_METER_PRIVATE_KEY      meter-b.js  BUYER_METER_PRIVATE_KEY
//   relayer.js  DEPLOYER_PRIVATE_KEY + BUYER_PRIVATE_KEY (gas and the shop's demo deposit)
//
//   npm run v2              meters + relayer (with the real Wokwi of Faras)
//   npm run v2 -- --mock    also start the Wokwi Stage 4E mock (only when the real Wokwi is OFF)
//   npm run v2 -- --monitor meters only: telemetry for the dashboard, no blockchain
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const parsed = loadEnv({ path: path.join(here, '..', '..', '..', '.env'), quiet: true, processEnv: {} }).parsed ?? {};
const args = new Set(process.argv.slice(2));
const mock = args.has('--mock');
const monitor = args.has('--monitor');

// Provisional Wokwi control format, used ONLY with the mock and only where .env leaves it empty.
const MOCK_CONTROL = {
  WOKWI_CTRL_BUYER_TOPIC: 'buyer_request', WOKWI_CTRL_BUYER_ON: '{"buyer_request":true}', WOKWI_CTRL_BUYER_OFF: '{"buyer_request":false}',
  WOKWI_CTRL_OUTAGE_TOPIC: 'grid', WOKWI_CTRL_OUTAGE_ON: '{"grid_status":"OUTAGE"}', WOKWI_CTRL_OUTAGE_OFF: '{"grid_status":"AVAILABLE"}',
  WOKWI_CTRL_BACKUP_TOPIC: 'backup', WOKWI_CTRL_BACKUP_ON: '{"emergency_backup_allowed":true}', WOKWI_CTRL_BACKUP_OFF: '{"emergency_backup_allowed":false}',
};

function envFor(allowedKeys) {
  const base = { ...process.env, ...parsed, AEGIS_ENV_FILTERED: '1' };
  if (mock) for (const [k, v] of Object.entries(MOCK_CONTROL)) if (!base[k]) base[k] = v;
  for (const k of Object.keys(base)) if (/PRIVATE_KEY$/.test(k) && !allowedKeys.includes(k)) delete base[k];
  return base;
}

const plan = [];
if (mock) plan.push({ name: 'mock-wokwi', keys: [], stdin: 'inherit' });
plan.push({ name: 'meter-a', keys: ['SELLER_METER_PRIVATE_KEY'] });
plan.push({ name: 'meter-b', keys: ['BUYER_METER_PRIVATE_KEY'] });
if (!monitor) plan.push({ name: 'relayer', keys: ['DEPLOYER_PRIVATE_KEY', 'BUYER_PRIVATE_KEY'] });

const children = plan.map(({ name, keys, stdin = 'ignore' }) => {
  const child = spawn(process.execPath, [path.join(here, `${name}.js`)], { env: envFor(keys), stdio: [stdin, 'inherit', 'inherit'] });
  child.on('exit', (code) => {
    console.log(`[run] ${name} stopped (code ${code}); stopping the others`);
    shutdown(code ?? 1);
  });
  return child;
});

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  children.forEach((c) => c.exitCode === null && c.kill());
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
console.log(`[run] started: ${plan.map((p) => p.name).join(', ')}${mock ? ' (MOCK Wokwi: keep the real Wokwi off)' : ''}`);
