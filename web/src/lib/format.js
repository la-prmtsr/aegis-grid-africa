import { IMPACT } from './config.js';

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '–');
export const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '–');

/** wei (bigint) → readable test-ETH amount. Demo prices are tiny, so show gwei below 0.0001 ETH. */
export function money(wei) {
  if (wei == null) return '–';
  const w = BigInt(wei);
  if (w === 0n) return '0 gwei';
  if (w < 100_000_000_000_000n) { // < 0.0001 ETH
    const g = Number(w) / 1e9;
    return `${g.toLocaleString('en-US', { maximumFractionDigits: g < 10 ? 2 : 0 })} gwei`;
  }
  return `${(Number(w) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`;
}

export const wh = (v) => (v == null ? '–' : `${Math.round(Number(v)).toLocaleString('en-US')} Wh`);
export const kwh = (v) => `${(Number(v) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} kWh`;
export const watts = (v) => (v == null ? '–' : `${Math.round(Number(v)).toLocaleString('en-US')} W`);
export const pct = (bps) => (bps == null ? '–' : `${(Number(bps) / 100).toFixed(1)}%`);
export const gapPct = (sellerWh, buyerWh) => (sellerWh ? ((sellerWh - buyerWh) / sellerWh) * 100 : null);

export function clock(sec) {
  if (!sec) return '–';
  const d = new Date(Number(sec) * 1000);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Simulated minutes since meter boot → hh:mm (the meters run TIME_SCALE times faster than real time). */
export function simClock(simMin) {
  if (simMin == null) return '--:--';
  const m = Math.floor(simMin) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function impact(deliveredWh) {
  const litres = (Number(deliveredWh) / 1000) * IMPACT.dieselLPerKWh;
  return { litres, co2Kg: litres * IMPACT.co2KgPerL };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
