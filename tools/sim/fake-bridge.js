// Fake bridge: runs the trade lifecycle of docs/data-format.md WITHOUT a blockchain.
// It shows that the meters (Wokwi or mock) follow the protocol, and it is the skeleton of the
// real bridge: replace `openTradeOnChain` with the contract's openTrade and `settle` with
// EIP-712 signing + settleTrade (see bridge/ once it exists).
import mqtt from 'mqtt';
import { MQTT_URL, SITE, topics } from './config.js';

const MAX_WH = Number(process.env.MAX_WH ?? 500);
const TOLERANCE_BPS = 300; // must match the contract (design parameter: 3%)

const c = mqtt.connect(MQTT_URL, { clientId: `aegis-fake-bridge-${Math.random().toString(16).slice(2, 8)}` });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let grid = 'AVAILABLE';
let wasRequesting = false;
let nextId = Number(process.env.START_ID ?? Math.floor(Date.now() / 1000) % 100000); // avoid clashing with old retained readings
let active = null; // { id, seller: reading|null, buyer: reading|null, buyerStopped }

const send = (meter, msg) => c.publish(topics.cmd(meter), JSON.stringify(msg));

async function openTradeOnChain() {
  return nextId++; // real bridge: await escrow.openTrade(...) and read the id from TradeOpened
}

function settle(t) {
  const s = t.seller.wh;
  const b = t.buyer.wh;
  if (s === 0 || b === 0) {
    log(`trade ${t.id}: zero reading -> not submitted (deposit refunded after expiry)`);
  } else {
    const agree = b <= s && (s - b) * 10000 <= s * TOLERANCE_BPS;
    log(`trade ${t.id}: seller=${s} Wh buyer=${b} Wh soc=${t.seller.socBpsAfter} ->`, agree ? `SETTLED (pay for ${b} Wh)` : 'DISPUTED (funds frozen)');
  }
  active = null;
}

c.on('connect', () => {
  log(`fake bridge connected to ${MQTT_URL} site=${SITE}`);
  c.subscribe([topics.grid, topics.telemetry('METER_B'), topics.readingWildcard]);
});

c.on('message', async (topic, buf) => {
  let d;
  try { d = JSON.parse(buf.toString()); } catch { return; }

  if (topic === topics.grid) {
    grid = d.status;
    return;
  }

  if (topic === topics.telemetry('METER_B')) {
    const req = Boolean(d.requesting);
    if (req && !wasRequesting && grid === 'OUTAGE' && !active) {
      const id = await openTradeOnChain();
      active = { id, seller: null, buyer: null };
      const targetW = Math.max(50, Number(d.loadW ?? 250));
      log(`trade ${id}: opened (maxWh=${MAX_WH}, targetW=${targetW})`);
      send('METER_A', { cmd: 'start', tradeId: id, maxWh: MAX_WH, targetW });
      send('METER_B', { cmd: 'start', tradeId: id });
    } else if (!req && wasRequesting && active && !active.seller) {
      log(`trade ${active.id}: shop stopped requesting -> stop seller first`);
      send('METER_A', { cmd: 'stop', tradeId: active.id });
    }
    wasRequesting = req;
    return;
  }

  const m = topic.match(/trade\/(\d+)\/reading\/(seller|buyer)$/);
  if (m && active && Number(m[1]) === active.id) {
    active[m[2]] = d;
    if (m[2] === 'seller') {
      log(`trade ${active.id}: seller final ${d.wh} Wh (${d.reason}) -> stop buyer`);
      setTimeout(() => active && send('METER_B', { cmd: 'stop', tradeId: active.id }), 300);
    }
    if (active.seller && active.buyer) settle(active);
  }
});
