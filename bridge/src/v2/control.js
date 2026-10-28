// Builds the MQTT message for one Wokwi REMOTE command from the .env format (see config.js).
// Pure function, unit-tested in test/v2.test.mjs.

/**
 * @param ctl   { topic, on, off, value } from WOKWI_CONTROL
 * @param input boolean for a switch, number (watts) for a setpoint
 * @returns { sub, payload } (sub is relative to demo/control/) or null when not configured
 */
export function controlMessage(ctl, input) {
  if (!ctl?.topic) return null;
  if (typeof input === 'boolean') {
    const payload = input ? ctl.on : ctl.off;
    return payload ? { sub: ctl.topic, payload } : null;
  }
  if (typeof input === 'number' && Number.isFinite(input) && input >= 0 && ctl.value) {
    return { sub: ctl.topic, payload: ctl.value.replaceAll('{value}', String(Math.round(input))) };
  }
  return null;
}
