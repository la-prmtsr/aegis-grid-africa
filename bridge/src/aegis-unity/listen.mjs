import 'dotenv/config';
import mqtt from 'mqtt';
import { TELEMETRY_TOPIC, normalizeTelemetry, allocate } from './core.mjs';
const mqttUrl = process.env.AEGIS_MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const client = mqtt.connect(mqttUrl, { clientId: `aegis-unity-adapter-${process.pid}`, reconnectPeriod: 2000 });
client.on('connect', () => client.subscribe(TELEMETRY_TOPIC, {qos:0}, err => {
  if (err) console.error('MQTT subscription failed:', err.message);
  else console.log(`Listening to ${TELEMETRY_TOPIC}`);
}));
client.on('message', (topic, message) => {
  if (topic !== TELEMETRY_TOPIC) return;
  try {
    const telemetry = normalizeTelemetry(JSON.parse(message.toString('utf8')));
    const allocation = allocate(telemetry);
    console.log(JSON.stringify({telemetry, allocation}));
    // Intentionally NO on-chain settlement here: current Wokwi has only Meter A.
  } catch (err) { console.error('Rejected telemetry:', err.message); }
});
client.on('error', err => console.error('MQTT:', err.message));
