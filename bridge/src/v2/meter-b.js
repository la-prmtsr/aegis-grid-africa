// Meter B (buyer, UMKM B shop). A separate simulated meter with its own key (BUYER_METER_PRIVATE_KEY).
// Its physical input in this simulation is the power flow from the Wokwi model as relayed by Meter A
// (the stand-in for the cable); it applies the line loss, keeps its own count and has its own tamper switch.
import { ethers } from 'ethers';
import { SIM, STAGE5B, topics, chain } from './config.js';
import { connect, logger } from './mqtt.js';
import { MeterBSim } from './meters.js';
import { domainFor, signReading, chainTimestamp } from './signing.js';
import { createFinalSigner } from './final-signer.js';

const log = logger('meter-B');
const meter = new MeterBSim({ sim: SIM });
let stopTimer = null;

let signer = null;
async function getSigner() {
  if (!signer) {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
    const { chainId } = await provider.getNetwork();
    signer = { provider, wallet: new ethers.Wallet(chain.buyerMeterKey), domain: domainFor(chainId, chain.escrow) };
    log(`signing key ${signer.wallet.address} (chain ${chainId})`);
  }
  return signer;
}

const { publish } = connect('meter-b', [topics.telemetry('METER_A'), topics.cmd('METER_B'), topics.appDemo, topics.final('METER_B')], async (topic, msg) => {
  if (topic === topics.final('METER_B')) return finals.onFinal(msg);
  if (topic === topics.cmd('METER_B') && msg.cmd === 'sign') return finals.onSignRequest(msg);
  if (topic === topics.telemetry('METER_A')) {
    const { telemetry, final } = meter.onSellerTelemetry(msg);
    if (telemetry) await publish(topics.telemetry('METER_B'), telemetry);
    if (final) await publishFinal(final);
  } else if (topic === topics.cmd('METER_B')) {
    await onCmd(msg);
  } else if (topic === topics.appDemo && typeof msg.tamper === 'boolean') {
    if (meter.tamper !== msg.tamper) log(msg.tamper ? `TAMPER ON: reporting ${SIM.tamperFactor * 100}% of what arrives` : 'tamper off');
    meter.tamper = msg.tamper;
  }
}, log);

async function onCmd(cmd) {
  if (cmd.cmd === 'start') {
    const superseded = meter.start({ tradeId: cmd.tradeId, maxWh: cmd.maxWh });
    if (superseded) await publishFinal(superseded);
    log(`trade ${cmd.tradeId} started`);
  } else if (cmd.cmd === 'stop') {
    const final = meter.stop({ tradeId: cmd.tradeId, untilSeq: cmd.untilSeq });
    if (final) return publishFinal(final);
    // wait for the seller's last counted message; close anyway after 5 s
    clearTimeout(stopTimer);
    stopTimer = setTimeout(async () => {
      const f = meter.forceStop();
      if (f) {
        log(`trade ${f.tradeId}: seller message ${cmd.untilSeq} never arrived, closing as incomplete`);
        await publishFinal(f);
      }
    }, 5000);
  }
}

async function publishFinal(final) {
  clearTimeout(stopTimer);
  const s = await getSigner();
  const signed = await signReading(s.wallet, s.domain, final, await chainTimestamp(s.provider));
  await publish(topics.reading(final.tradeId, 'buyer'), signed, { retain: true });
  log(`trade ${final.tradeId} final: ${final.wh} Wh received${final.tamper ? ' (TAMPERED)' : ''}${final.incomplete ? ' (incomplete)' : ''}`);
}

// Stage 5B.3: signs METER_B's own final event, only on a testnet settlement request
const finals = createFinalSigner({ meterId: 'METER_B', getSigner, publish: (...a) => publish(...a), log });
log(`line loss ${SIM.lineLoss * 100}%, waiting for Meter A; evidence ${STAGE5B.evidence}, settlement ${STAGE5B.settlementMode}`);
