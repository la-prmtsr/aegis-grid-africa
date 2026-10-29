// Small MQTT helpers shared by the v2 processes.
import mqtt from 'mqtt';
import { MQTT_URL } from './config.js';

export const time = () => new Date().toLocaleTimeString('en-GB');
export const logger = (tag) => (...a) => console.log(time(), `[${tag}]`, ...a);

/**
 * Connect, subscribe on every (re)connect, and parse JSON payloads for the handler.
 * opts.raw: hand payloads that are not JSON (Faras's plain controls such as "remote") to the handler as a string
 * instead of dropping them. A handler error is logged, never fatal.
 */
export function connect(name, subscriptions, onMessage, log, opts = {}) {
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
    const text = payload.toString('utf8');
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      if (!opts.raw) return; // not JSON
      msg = text.trim();
    }
    const fail = (err) => log(`ERROR on ${topic}: ${err.shortMessage ?? err.message}`);
    try {
      Promise.resolve(onMessage(topic, msg)).catch(fail);
    } catch (err) {
      fail(err);
    }
  });
  const publish = (topic, msg, opts = {}) =>
    new Promise((resolve) => client.publish(topic, typeof msg === 'string' ? msg : JSON.stringify(msg), { qos: 1, ...opts }, () => resolve()));
  return { client, publish };
}
