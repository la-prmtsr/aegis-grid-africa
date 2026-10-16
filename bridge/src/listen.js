// Step 6: listen to the meters and print what they say. Nothing is sent to the blockchain.
import mqtt from 'mqtt';
import { MQTT_URL, SITE, topics } from './config.js';

const time = () => new Date().toLocaleTimeString('en-GB');
const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
  console.log(`${time()} connected to ${MQTT_URL} (site: ${SITE})`);
  client.subscribe([topics.grid, topics.telemetryAll, topics.readingAll]);
});

client.on('error', (err) => console.log(`${time()} MQTT error: ${err.message}`));

client.on('message', (topic, payload) => {
  let msg;
  try {
    msg = JSON.parse(payload.toString());
  } catch {
    return; // ignore anything that is not JSON
  }

  if (topic === topics.grid) {
    console.log(`${time()} GRID   ${msg.status}`);
  } else if (msg.role === 'seller' && topic.endsWith('/telemetry')) {
    console.log(`${time()} SELLER battery ${(msg.socBps / 100).toFixed(1)}%  solar ${msg.pvW} W  export ${msg.exportW} W  [${msg.status}]`);
  } else if (msg.role === 'buyer' && topic.endsWith('/telemetry')) {
    console.log(`${time()} BUYER  load ${msg.loadW} W  receiving ${msg.importW} W  requesting=${msg.requesting}  [${msg.status}]`);
  } else if (topic.includes('/reading/')) {
    console.log(`${time()} FINAL  trade ${msg.tradeId} ${msg.role}: ${msg.wh} Wh`);
  }
});