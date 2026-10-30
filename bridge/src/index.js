// The Aegis-Grid bridge: meters (MQTT) <-> AegisEscrow (blockchain).
// Lifecycle: docs/data-format.md, "Trade lifecycle".
import mqtt from 'mqtt';
import { MQTT_URL, SITE, TRADE, topics } from './config.js';
import { connectChain, STATUS } from './chain.js';

const time = () => new Date().toLocaleTimeString('en-GB');
const log = (...a) => console.log(time(), ...a);

const { chainId, escrow, openTrade, settleTrade, sellerMeter, buyerMeter } = await connectChain();
const explorer = chainId === 84532n ? 'https://base-sepolia.blockscout.com/tx/' : null;
const link = (hash) => (explorer ? explorer + hash : hash);

log(`chain ${chainId}, escrow ${await escrow.getAddress()}`);
log(`meter keys: seller ${sellerMeter.address}, buyer ${buyerMeter.address}`);

let grid = 'AVAILABLE';
let wasRequesting = false;
let busy = false; // true while a blockchain call is running
let active = null; // { id, seller, buyer } for the trade in progress

const client = mqtt.connect(MQTT_URL);
const send = (meterId, msg) => client.publish(topics.cmd(meterId), JSON.stringify(msg));

client.on('connect', () => {
  log(`connected to ${MQTT_URL} (site: ${SITE})`);
  client.subscribe([topics.grid, topics.telemetry('METER_B'), topics.readingAll]);
});
client.on('error', (err) => log(`MQTT error: ${err.message}`));

client.on('message', async (topic, payload) => {
  let msg;
  try { msg = JSON.parse(payload.toString()); } catch { return; }

  try {
    if (topic === topics.grid) {
      if (msg.status !== grid) log(`grid is now ${msg.status}`);
      grid = msg.status;
    } else if (topic === topics.telemetry('METER_B')) {
      await onBuyerTelemetry(msg);
    } else if (topic.includes('/reading/')) {
      await onFinalReading(msg);
    }
  } catch (err) {
    busy = false;
    log(`ERROR: ${err.shortMessage ?? err.message}`);
  }
});

// 1-3. The shop pressed "Request Clean Power" during an outage: open a trade, start both meters.
async function onBuyerTelemetry(msg) {
  const requesting = Boolean(msg.requesting);

  if (requesting && !wasRequesting && grid === 'OUTAGE' && !active && !busy) {
    busy = true;
    log(`shop requests clean power -> openTrade (max ${TRADE.maxWh} Wh) ...`);
    const { id, txHash } = await openTrade();
    active = { id, seller: null, buyer: null };
    busy = false;
    log(`trade ${id} OPENED  ${link(txHash)}`);

    const targetW = Math.max(50, Number(msg.loadW ?? 250));
    send('METER_A', { cmd: 'start', tradeId: id, maxWh: Number(TRADE.maxWh), targetW });
    send('METER_B', { cmd: 'start', tradeId: id });
  } else if (!requesting && wasRequesting && active && !active.seller) {
    // 5. The shop stopped: stop the seller first; the buyer is stopped after the seller's final reading.
    log(`trade ${active.id}: shop stopped requesting -> stop seller`);
    send('METER_A', { cmd: 'stop', tradeId: active.id });
  }
  wasRequesting = requesting;
}

// 5-6. Collect both final readings, then sign and settle on-chain.
async function onFinalReading(msg) {
  if (!active || Number(msg.tradeId) !== active.id || active[msg.role]) return;
  active[msg.role] = msg;
  log(`trade ${active.id}: ${msg.role} meter final reading ${msg.wh} Wh${msg.reason ? ` (${msg.reason})` : ''}`);

  if (msg.role === 'seller') {
    setTimeout(() => active && send('METER_B', { cmd: 'stop', tradeId: active.id }), 300);
    return;
  }
  if (!active.seller || !active.buyer) return;

  const trade = active;
  active = null;
  if (trade.seller.wh === 0 || trade.buyer.wh === 0) {
    log(`trade ${trade.id}: a reading is 0 Wh -> not submitted; the buyer can be refunded after expiry`);
    return;
  }

  busy = true;
  log(`trade ${trade.id}: signing both readings and calling settleTrade ...`);
  const r = await settleTrade(trade.id, trade.seller, trade.buyer);
  busy = false;

  if (r.outcome === 'SETTLED') {
    log(`trade ${trade.id} SETTLED: paid for ${r.deliveredWh} Wh  ${link(r.txHash)}`);
  } else if (r.outcome === 'DISPUTED') {
    log(`trade ${trade.id} DISPUTED: seller ${r.sellerWh} Wh vs buyer ${r.buyerWh} Wh, funds frozen  ${link(r.txHash)}`);
  } else {
    log(`trade ${trade.id}: unexpected result ${link(r.txHash)}`);
  }

  // Public RPC nodes can lag a block behind: retry briefly until the new state is visible.
  for (let i = 0; i < 5; i++) {
    const t = await escrow.trades(trade.id);
    if (STATUS[Number(t.status)] !== 'Open') {
      log(`trade ${trade.id} status on-chain: ${STATUS[Number(t.status)]}, total delivered so far: ${await escrow.totalDeliveredWh()} Wh`);
      return;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  log(`trade ${trade.id}: the RPC node has not caught up yet; check the explorer link above`);
} 