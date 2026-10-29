// Operator "Control room": the Unity Unified Control panel and Energy Metrics, moved into the dashboard,
// so Unity only visualises and every control lives here.
// Data: Meter A telemetry (meter/METER_A/telemetry, Faras's Stage 4E fields normalised by the backend),
// Meter B telemetry and the relayer status (backend/status). Controls publish through simControl():
// requesting -> app/request, everything else -> app/demo (docs/integration-v2.md).
import { state } from '../lib/store.js';
import { meterOnline } from '../lib/mqtt.js';
import { METER } from '../lib/config.js';
import { esc } from '../lib/format.js';

const W = (v) => (Number.isFinite(Number(v)) ? `${Math.round(Number(v))} W` : '–');
const pctTxt = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '–');
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Derived Stage 4E metrics from the latest Meter A telemetry (null when no data). */
export function metrics() {
  const s = state.seller;
  if (!s) return null;
  const pv = Number(s.pvW) || 0;
  const delivered = Number(s.pvDeliveredW) || 0;
  const community = Number(s.loadW) || 0;
  const buyer = Number(s.buyerDemandW) || 0;
  const demand = Number(s.totalDemandW ?? community + buyer);
  const unserved = Number(s.unservedW) || 0;
  const charge = Number(s.chargeW) || 0;
  const discharge = Number(s.dischargeW ?? (Number(s.exportW) || 0) + (Number(s.dischargeLocalW) || 0)) || 0;
  const soc = Number(s.socBps) / 100;
  const reserve = Number(s.minSocPct ?? 5);
  const outage = s.grid === 'OUTAGE';
  return {
    source: s.source || 'wokwi',
    pv, delivered, deliveryPct: pv > 0 ? (delivered / pv) * 100 : null,
    // PV that can reach the community before battery/grid dispatch: none while the PCC is open (PV is isolated)
    community, buyer, demand, balance: (s.grid === 'OUTAGE' ? 0 : pv) - demand,
    soc, reserve, charge, discharge,
    batteryState: charge > 0.5 ? 'CHARGING' : discharge > 0.5 ? 'DISCHARGING' : soc <= reserve + 0.1 ? 'AT RESERVE' : 'IDLE',
    outage, backup: Boolean(s.backupAllowed), gridImport: Number(s.gridImportW) || 0,
    unserved, servedPct: demand > 0 ? ((demand - unserved) / demand) * 100 : 100,
    energyStatus: s.energyStatus || '–',
    allocation: s.allocation || null,
    exportW: Number(s.exportW) || 0,
    tradeId: Number(s.tradeId) || 0,
  };
}

const ageS = () => {
  const t = state.lastSeen[METER.seller];
  return t ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
};
const statusTone = (st) => (/SHORTAGE/.test(st) ? 'bad' : /ISLAND|EMERGENCY|PENDING/.test(st) ? 'warn' : /NORMAL/.test(st) ? 'ok' : 'idle');
const bar = (pct, tone, label, marker) => `<div class="cr-bar" role="img" aria-label="${esc(label)} ${pctTxt(pct)}"><i style="width:${(clamp01((pct ?? 0) / 100) * 100).toFixed(1)}%;background:var(--${tone})"></i>${marker != null ? `<b style="left:${clamp01(marker / 100) * 100}%" title="reserve"></b>` : ''}</div>`;
const row = (label, value, cls = '') => `<div class="row"><span>${label}</span><b class="${cls}">${value}</b></div>`;

// ------------------------------------------------------------------ Unified control (left panel)
// The engine the operator picked. Kept here because switching to Wokwi pauses the mock, and until Wokwi
// sends, the telemetry alone cannot tell which engine is selected.
let engineChoice = null;
export const chooseEngine = (e) => { engineChoice = e; };
const engineNow = () => engineChoice ?? (metrics()?.source === 'wokwi' ? 'wokwi' : 'mock');

export function ctlHead() {
  const m = metrics();
  const age = ageS();
  const live = m && meterOnline(METER.seller);
  const sub = !m ? '<span class="cr-src idle">no telemetry yet</span>'
    : !live ? `<span class="cr-src bad">no data for ${age}s${engineNow() === 'wokwi' ? ' · waiting for Wokwi' : ''}</span>`
    : m.source === 'mock' ? '<span class="cr-src warn">source: mock</span>' : '<span class="cr-src ok">source: Wokwi ESP32</span>';
  return `<h2>Unified control</h2>${sub}`;
}

/**
 * Demo / Live switch in the panel corner. It is updated in place (not re-rendered) so the knob slides.
 * Demo = the Wokwi-compatible mock, Live = Faras's Wokwi ESP32 (Unity mirrors it).
 */
export function syncEngineSwitch(hosts) {
  const live = engineNow() === 'wokwi';
  hosts.forEach((host) => {
    let sw = host.querySelector('.cr-switch');
    if (!sw) {
      host.innerHTML = '<button class="cr-switch" type="button" role="switch"><span class="cr-sw-knob" aria-hidden="true"></span><span class="cr-sw-l">Demo</span><span class="cr-sw-l"><i aria-hidden="true"></i>Live</span></button>';
      sw = host.firstChild;
    }
    sw.setAttribute('aria-checked', String(live));
    sw.dataset.act = live ? 'engine-mock' : 'engine-wokwi';
    sw.setAttribute('aria-label', `Simulation engine: ${live ? 'Wokwi live' : 'demo mock'}`);
    sw.title = live ? "Wokwi live: Faras's ESP32, Unity mirrors it. Click for the demo mock." : 'Demo: the Wokwi-compatible mock. Click for Wokwi live.';
  });
}

/** Sliders. While a slider has focus, patch() leaves this part alone, so dragging is never interrupted. */
export function ctlSliders() {
  const m = metrics();
  const wc = state.backend?.wokwiControl || {};
  const lockedBy = (key) => m && m.source === 'wokwi' && !wc[key];
  const slider = (key, ctl, label, value, max, note) => {
    const locked = lockedBy(key);
    const v = Math.round(value ?? 0);
    return `<div class="cr-slider" title="${note}">
      <label for="cr-${ctl}"><span>${label}</span><output id="cr-${ctl}-out" for="cr-${ctl}" class="mono">${m ? `${v} W` : '–'}</output></label>
      <input id="cr-${ctl}" type="range" min="0" max="${max}" step="10" value="${v}" data-ctl="${ctl}" aria-valuetext="${v} watts" ${!m || locked ? 'disabled' : ''}>
      ${locked ? '<small>Set by the potentiometer in Wokwi (remote control not configured yet)</small>' : ''}
    </div>`;
  };
  return slider('pv', 'pvW', 'PV production', m?.pv, 1000, 'Solar output of the PV array at the PCC')
    + slider('load', 'communityLoadW', 'Community load', m?.community, 600, 'City Hall and the other buildings on the AC bus');
}

const ICONS = {
  outage: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/><path d="M3 3l18 18"/>',
  request: '<path d="M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5L4 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  backup: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M11 9l-2 3h4l-2 3"/>',
  tamper: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
};
/** On/off tile: full grey when off, filled with its colour when on. */
const tile = (act, icon, label, stateTxt, on, tone, disabled, hint) =>
  `<button class="cr-tile ${tone}" type="button" data-act="${act}" aria-pressed="${on}" ${disabled ? 'disabled' : ''} title="${hint}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>
    <b>${label}</b><small>${stateTxt}</small></button>`;

export function ctlToggles() {
  const m = metrics();
  const b = state.buyer;
  const be = state.backend;
  const requesting = Boolean(b?.requesting || be?.requests?.app);
  const tradeId = Number(b?.tradeId || be?.active?.id || 0);
  const none = !m;
  return `<div class="cr-label">Scenario</div><div class="cr-tiles">
    ${tile('t-outage', 'outage', 'Utility outage', m?.outage ? 'Islanded' : 'Off', !!m?.outage, 'red', none, 'Opens the PCC: the street runs on the battery only')}
    ${tile('t-request', 'request', 'Buyer request', requesting ? (tradeId ? `Trade #${tradeId}` : 'Opening…') : 'Off', requesting, 'blue', none, 'UMKM B asks for 250 W: opens a trade on-chain')}
    ${tile('t-backup', 'backup', 'Emergency backup', m?.backup ? 'On' : 'Off', !!m?.backup, 'green', none, 'Resident A lets the battery also feed the community loads')}
    ${be?.controls?.tamper === false
      ? tile('t-tamper', 'tamper', 'Tamper Meter B', 'In Wokwi', false, 'amber', true, 'Stage 5B: METER_B runs as Faras’s ESP32 in Wokwi. Switch its tamper there; the backend never alters a meter value.')
      : tile('t-tamper', 'tamper', 'Tamper Meter B', b?.tamper ? '−40%' : 'Off', !!b?.tamper, 'amber', !b, 'Meter B under-reports by 40%: the backend rejects the trade')}
  </div>`;
}

export function ctlFoot() {
  const m = metrics();
  const be = state.backend;
  const wc = be?.wokwiControl;
  const chips = wc
    ? Object.entries({ buyer: 'Buyer', outage: 'Outage', backup: 'Backup', pv: 'PV', load: 'Load' })
      .map(([k, l]) => `<span class="pill ${wc[k] ? 'ok' : 'idle'}">${l}</span>`).join('')
    : '<span class="pill idle">relayer not running</span>';
  return `<div class="cr-strip">
      <div><span>Battery SoC</span><b class="mono">${m ? `${m.soc.toFixed(1)}%` : '–'}</b></div>
      <div><span>Battery reserve</span><b class="mono">${m ? m.reserve : 5}%</b></div>
      <div><span>Applied PV</span><b class="mono">${m ? W(m.pv) : '–'}</b></div>
      <div><span>Status</span>${m ? `<span class="pill ${statusTone(m.energyStatus)}">${esc(m.energyStatus)}</span>` : '<b>–</b>'}</div>
    </div>
    <div class="cr-remote" title="Green = the backend forwards this control to Wokwi (demo/control/…). Grey = not configured yet, so it only acts on the mock. Buyer requests always open the trade on-chain first.">
      <span class="cr-label">Wokwi remote</span><div class="cr-chips">${chips}</div>
    </div>`;
}

// ------------------------------------------------------------------ Energy metrics (right panel)
export function metricsHTML() {
  const m = metrics();
  if (!m) return '<div class="ph"><h2>Energy metrics</h2></div><p class="empty">Waiting for Wokwi telemetry…</p>';
  const age = ageS();
  const group = (title, body) => `<div class="cr-group"><h3>${title}</h3>${body}</div>`;
  return `<div class="ph"><h2>Energy metrics</h2><span class="pill ${statusTone(m.energyStatus)}">${esc(m.energyStatus)}</span></div>
  <div class="cr-groups">
    ${group('Generation', `${row('PV generated', W(m.pv))}${row('Delivered to microgrid', W(m.delivered))}
      ${row('PV delivery', pctTxt(m.deliveryPct))}${bar(m.deliveryPct, 'amber', 'PV delivery')}`)}
    ${group('Demand', `${row('Community load', W(m.community))}${row('Buyer request · UMKM B', W(m.buyer))}${row('Total demand', W(m.demand))}
      ${row('PV balance at community', `${m.balance >= 0 ? '+' : '−'}${Math.abs(Math.round(m.balance))} W`, m.balance >= 0 ? 'pos' : 'neg')}`)}
    ${group('Battery · Resident A', `<div class="cr-soc"><b class="mono">${m.soc.toFixed(1)}<small>%</small></b><span class="pill ${m.batteryState === 'CHARGING' ? 'ok' : m.batteryState === 'DISCHARGING' ? 'blue' : m.batteryState === 'AT RESERVE' ? 'bad' : 'idle'}">${m.batteryState}</span></div>
      ${bar(m.soc, 'green', 'Battery state of charge', m.reserve)}
      ${row('Charge | Discharge', `${W(m.charge)} | ${W(m.discharge)}`)}${row('Minimum reserve', `${m.reserve}%`)}`)}
    ${group('Grid', `${row('Utility', m.outage ? '<span class="neg">OUTAGE</span>' : 'AVAILABLE')}${row('PCC', m.outage ? '<span class="neg">OPEN</span>' : 'CLOSED')}
      ${row('Emergency backup', m.backup ? '<span class="pos">ON</span>' : 'OFF')}${row('Grid import', W(m.gridImport))}`)}
    ${group('Supply', `${row('Unserved', W(m.unserved), m.unserved > 0.5 ? 'neg' : '')}${row('Load served (total)', pctTxt(m.servedPct))}
      ${bar(m.servedPct, m.servedPct >= 99.5 ? 'green' : m.servedPct >= 60 ? 'amber' : 'alert', 'Load served')}`)}
    ${group('Telemetry', `${row('Source', m.source === 'mock' ? 'Mock' : 'Wokwi ESP32')}${row('Last message', age == null ? '–' : `${age}s ago`, age > 5 ? 'neg' : '')}
      ${row('P2P to UMKM B', W(m.exportW))}${row('Active trade', m.tradeId ? `#${m.tradeId}` : '–')}`)}
  </div>`;
}

// ------------------------------------------------------------------ Overview card
export function quickHTML() {
  const m = metrics();
  return `<div class="ph"><h2>Live status</h2>${m ? `<span class="pill ${m.source === 'mock' ? 'warn' : 'ok'}">${m.source === 'mock' ? 'mock' : 'Wokwi live'}</span>` : '<span class="pill idle">no data</span>'}</div>
    <div class="rows">
      ${row('Grid · PCC', m ? (m.outage ? '<span class="neg">Outage · open</span>' : 'Available · closed') : '–')}
      ${row('Battery · Resident A', m ? `${m.soc.toFixed(1)}% · ${m.batteryState.toLowerCase()}` : '–')}
      ${row('Emergency backup', m ? (m.backup ? 'on' : 'off') : '–')}
      ${row('Load served', m ? pctTxt(m.servedPct) : '–')}
      ${row('Energy status', m ? `<span class="pill ${statusTone(m.energyStatus)}">${esc(m.energyStatus)}</span>` : '–')}
    </div>
    <button class="btn btn-dark" type="button" data-act="go-control" style="width:100%;margin-top:14px">Open control room</button>
    <p class="note">All simulation controls (PV, load, outage, buyer request, emergency backup, engine) are in the control room. Unity only visualises.</p>`;
}
