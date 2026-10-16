// Shared settings for the simulator scripts. Override with environment variables.
export const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://broker.hivemq.com:1883';
export const SITE = process.env.SITE ?? 'ag-demo'; // CHANGE: same value as in the firmware
export const TIME_SCALE = Number(process.env.TIME_SCALE ?? 60); // 1 real second = 1 simulated minute
export const LINE_ID = 'L1';

export const P = `aegisgrid/${SITE}/`;
export const topics = {
  grid: `${P}grid`,
  telemetry: (meterId) => `${P}meter/${meterId}/telemetry`,
  cmd: (meterId) => `${P}meter/${meterId}/cmd`,
  line: `${P}line/${LINE_ID}`,
  reading: (tradeId, role) => `${P}trade/${tradeId}/reading/${role}`,
  readingWildcard: `${P}trade/+/reading/+`,
  simControl: `${P}sim/control`,
};

/** Round to one decimal for telemetry (final readings use integers). */
export const r1 = (x) => Math.round(x * 10) / 10;
