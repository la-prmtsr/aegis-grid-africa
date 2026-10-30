// Stage 6.1 tamper self-check: does METER_B (Faras's Wokwi firmware, or the mock) obey the dashboard's tamper switch?
//
//   npm run v2:tamper-check
//
// Sends the same control the dashboard tile sends (WOKWI_CTRL_TAMPER_* in .env, default demo/control/meter_b_tamper
// 1 / 0), then watches METER_B's own telemetry (meter/METER_B/telemetry) for "tamper": true and back to false.
// Run it with the real Wokwi on and the backend off or idle (no trade needed). Read-only apart from the two controls.
import { SITE, MQTT_URL, WOKWI_CONTROL, topics } from './config.js';
import { connect, logger } from './mqtt.js';
import { controlMessage } from './control.js';

const log = logger('tamper-check');
const ctl = WOKWI_CONTROL.tamper.topic ? WOKWI_CONTROL.tamper : { topic: 'meter_b_tamper', on: '1', off: '0' };
const WAIT_MS = 8000;

let last = null; // last METER_B firmware telemetry
let seen = 0;
const waiters = [];
const { publish, client } = connect('tamper-check', [topics.telemetry('METER_B')], (topic, msg) => {
  if (msg?.v === 2) return; // the backend's own METER_B view, not the firmware
  last = msg;
  seen += 1;
  waiters.forEach((w) => w());
}, log);

/** Wait until METER_B telemetry satisfies `ok`, or time out. */
const until = (ok) => new Promise((resolve) => {
  const check = () => { if (last && ok(last)) { done(true); } };
  const done = (v) => { clearTimeout(t); waiters.splice(waiters.indexOf(check), 1); resolve(v); };
  const t = setTimeout(() => done(false), WAIT_MS);
  waiters.push(check);
  check();
});

async function send(on) {
  const m = controlMessage(ctl, on);
  await publish(topics.wokwiControl(m.sub), m.payload);
  log(`sent demo/control/${m.sub} ${m.payload}`);
}

async function main() {
  log(`site ${SITE} on ${MQTT_URL}: waiting for METER_B telemetry on ${topics.telemetry('METER_B')} ...`);
  if (!(await until(() => true))) {
    log('FAIL: no METER_B firmware telemetry in 8 s. Is Wokwi METER_B running, and does the Mosquitto bridge forward meter/METER_B/telemetry out?');
    return 1;
  }
  if (!('tamper' in last)) log('WARNING: METER_B telemetry has no "tamper" field; add it so the dashboard and this check can see the switch.');

  await send(true);
  const onOk = await until((m) => m.tamper === true);
  log(onOk ? 'OK: METER_B reports "tamper": true' : 'FAIL: METER_B did not report "tamper": true within 8 s (does it subscribe to demo/control/meter_b_tamper, and does the bridge forward demo/control/# in?)');

  await send(false);
  const offOk = await until((m) => m.tamper === false);
  log(offOk ? 'OK: METER_B reports "tamper": false again' : 'FAIL: METER_B did not switch tamper off within 8 s');

  if (onOk && offOk) {
    log('PASS. Next: in the dashboard turn on Tamper Meter B, order 20 Wh during an outage: the trade must end Disputed (testnet) or Rejected (SETTLEMENT_MODE=off).');
    return 0;
  }
  return 1;
}

main().then((code) => { client.end(true, () => process.exit(code)); setTimeout(() => process.exit(code), 1000); });
