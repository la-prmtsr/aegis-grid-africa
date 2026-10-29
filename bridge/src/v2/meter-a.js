// Meter A gateway (seller, Resident A). Reads Faras's Wokwi Stage 4E telemetry WITHOUT publishing to
// Wokwi or Unity, republishes it for the dashboard, counts the energy exported to the buyer per trade,
// and signs the seller's final reading with SELLER_METER_PRIVATE_KEY only.
import { ethers } from 'ethers';
import { SITE, SIM, STAGE5B, topics, chain } from './config.js';
import { connect, logger } from './mqtt.js';
import { MeterAGateway } from './meters.js';
import { domainFor, signReading, chainTimestamp } from './signing.js';
import { createFinalSigner } from './final-signer.js';

const log = logger('meter-A');
const gw = new MeterAGateway({ site: SITE, sim: SIM });

let signer = null; // created on the first final reading
async function getSigner() {
  if (!signer) {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
    const { chainId } = await provider.getNetwork();
    signer = { provider, wallet: new ethers.Wallet(chain.sellerMeterKey), domain: domainFor(chainId, chain.escrow) };
    log(`signing key ${signer.wallet.address} (chain ${chainId})`);
  }
  return signer;
}

let lastGrid = null;
let lastGridSent = 0;
let lastReject = 0;
let lastScaleLog = 0;

const { publish } = connect('meter-a', [topics.wokwiTelemetry, topics.cmd('METER_A'), topics.final('METER_A')], async (topic, msg) => {
  if (topic === topics.wokwiTelemetry) return onWokwi(msg);
  if (topic === topics.final('METER_A')) return finals.onFinal(msg);
  if (topic === topics.cmd('METER_A')) return msg.cmd === 'sign' ? finals.onSignRequest(msg) : onCmd(msg);
}, log);
// Stage 5B.3: signs METER_A's own final event, only on a testnet settlement request
const finals = createFinalSigner({ meterId: 'METER_A', getSigner, publish: (...a) => publish(...a), log });

async function onWokwi(raw) {
  let out;
  try {
    out = gw.onWokwi(raw, Date.now());
  } catch (err) {
    if (Date.now() - lastReject > 5000) log(`rejected Wokwi message: ${err.message}`);
    lastReject = Date.now();
    return;
  }
  const { telemetry, issues, final } = out;
  await publish(topics.telemetry('METER_A'), telemetry);
  if (issues.length && Date.now() - lastReject > 5000) {
    log(`flagged (not settlement evidence): ${issues.join('; ')}`);
    lastReject = Date.now();
  }
  if (telemetry.grid !== lastGrid || Date.now() - lastGridSent > 10000) {
    if (telemetry.grid !== lastGrid) log(`grid is ${telemetry.grid}`);
    lastGrid = telemetry.grid;
    lastGridSent = Date.now();
    await publish(topics.grid, { v: 2, status: telemetry.grid, source: 'METER_A', simulated: true }, { retain: true });
  }
  const est = telemetry.wokwiTimeScaleEstimate;
  if (est && Date.now() - lastScaleLog > 60000) {
    lastScaleLog = Date.now();
    const off = Math.abs(est - SIM.timeScale) / SIM.timeScale > 0.25;
    log(`Wokwi battery model runs at about ${est}x real time; energy accounting uses ${SIM.timeScale}x${off ? ' (MISMATCH: see docs/integration-v2.md, "Time scale")' : ''}`);
  }
  if (final) await publishFinal(final);
}

async function onCmd(cmd) {
  if (cmd.cmd === 'start') {
    const superseded = gw.start({ tradeId: cmd.tradeId, maxWh: cmd.maxWh });
    if (superseded) await publishFinal(superseded);
    log(`trade ${cmd.tradeId} started (max ${cmd.maxWh} Wh)`);
  } else if (cmd.cmd === 'stop' && gw.trade && Number(cmd.tradeId) === gw.trade.id) {
    await publishFinal(gw.stop('stop_cmd'));
  }
}

async function publishFinal(final) {
  const s = await getSigner();
  const signed = await signReading(s.wallet, s.domain, final, await chainTimestamp(s.provider));
  await publish(topics.reading(final.tradeId, 'seller'), signed, { retain: true });
  log(`trade ${final.tradeId} final: ${final.wh} Wh sent, battery ${(final.socBpsAfter / 100).toFixed(2)}% (${final.reason})${final.issues.length ? ` FLAGGED: ${final.issues.join('; ')}` : ''}`);
}

log(`listening to ${topics.wokwiTelemetry} (read only); evidence ${STAGE5B.evidence}, settlement ${STAGE5B.settlementMode}`);
