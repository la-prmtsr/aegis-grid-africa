// Small MQTT helpers shared by the v2 processes.
import mqtt from 'mqtt';
import { MQTT_URL } from './config.js';

export const time = () => new Date().toLocaleTimeString('en-GB');
export const logger = (tag) => (...a) => console.log(time(), `[${tag}]`, ...a);

/** Connect, subscribe on every (re)connect, and parse JSON payloads for the handler. */
export function connect(name, subscriptions, onMessage, log) {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `aegis-${name}-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
  });
  client.on('connect', () => {
    log(`connected to ${MQTT_URL}`);
    client.subscribe(subscriptions, { qos: 1 }, (err) => err && log(`subscribe failed: ${err.message}`));
  });
  client.on('reconnect', () => log('reconnecting to MQTT ...'));
  client.on('error', (err) => log(`MQTT error: ${err.message}`));
  client.on('message', (topic, payload) => {
    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch {
      return; // not JSON
    }
    Promise.resolve(onMessage(topic, msg)).catch((err) => log(`ERROR: ${err.shortMessage ?? err.message}`));
  });
  const publish = (topic, msg, opts = {}) =>
    new Promise((resolve) => client.publish(topic, typeof msg === 'string' ? msg : JSON.stringify(msg), { qos: 1, ...opts }, () => resolve()));
  return { client, publish };
}
