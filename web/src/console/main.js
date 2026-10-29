// Aegis-Grid console: buyer (shop), seller (battery owner) and operator views.
// Live data: meter telemetry over MQTT (docs/data-format.md) + AegisEscrow events and views on Base Sepolia.
import { ACCOUNTS, CHAIN, SITE, MQTT_WS_URL, METER, MOMO, IMPACT, txUrl, addrUrl } from '../lib/config.js';
import { fiat, whToFiat, depositFiat, generatorFiat, momoForTrade } from '../lib/momo.js';
import { state, subscribe, update, tradeList } from '../lib/store.js';
import { startMqtt, simControl, meterOnline } from '../lib/mqtt.js';
import { startChain, connectWallet, resumeWallet, useWallet, disconnectWallet, hasWallet, tx, isAddress, same, explain } from '../lib/chain.js';
import { getSession, clearSession, initials, maskPhone, METHOD_LABEL } from '../lib/session.js';
import { money, wh, watts, pct, gapPct, clock, simClock, impact, short, shortHash, esc } from '../lib/format.js';
import { orderPickerHTML, requestCardHTML, openingCardHTML, liveSessionHTML, closingCardHTML, momoCheckoutHTML, buyerReceiptHTML } from './buyer-session.js';
import { clampOrder, maxWhFor, receivedEstimate, orderSteps, DEFAULT_RATE } from '../lib/sizing.js';
import { receiptHTML as tradeReceiptHTML, receiptNav, mountReceiptDrawer, chainButtonHTML } from './receipt.js';
import { ctlHead, syncEngineSwitch, chooseEngine, ctlSliders, ctlToggles, ctlFoot, metricsHTML, quickHTML } from './control-room.js';

const session = getSession() || { name: 'Guest', method: 'guest' };
/** Greet the signed-in person; guests get a neutral greeting. */
const greetName = () => (session.method === 'guest' ? 'there'
  : session.method === 'wallet' && session.name.startsWith(session.walletName || '\u0000') ? 'there'
  : session.name.split(' ')[0]);

startMqtt();
startChain();
if (session.method === 'wallet') resumeWallet(session.rdns); // reconnect without a popup if the wallet allows it
else useWallet(null);

// ------------------------------------------------------------------ view state
const ui = {
  persona: localGet('aegis.persona', 'ama'),
  mode: localGet('aegis.mode', 'buyer'),
  busy: null, // name of the wallet action in progress
  momo: null, // simulated MoMo checkout step: null | 'confirm' | 'prompt' | 'processing' | 'declined'
  receiptId: null, // operator Mobile money: trade whose receipt is shown (null = newest)
  targetWh: Number(localGet('aegis.order', '0')) || null, // Stage 6: buyer's order size (Wh); null = default for the rate
  page: null, // sidebar page shown in the current view (one page at a time, kept in the URL hash)
};
function localGet(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

const PERSONAS = {
  ama: { ...ACCOUNTS.buyer, init: 'B', color: '#B45309', role: 'buyer' },
  kwame: { ...ACCOUNTS.seller, init: 'S', color: '#2563EB', role: 'seller' },
  ops: { name: 'Aegis Operator', init: 'OP', color: '#0E1B2C', role: 'ops' },
};

const NAV = {
  buyer: [['b-home', 'Get power'], ['b-history', 'Receipts'], ['b-impact', 'Impact']],
  seller: [['s-node', 'Battery'], ['s-earn', 'Earnings'], ['s-meter', 'Meter']],
  gate: [['g-main', 'Start']],
  ops: [['o-overview', 'Overview'], ['o-grid', 'Control room'], ['o-oracle', 'Oracle'], ['o-momo', 'Mobile money'], ['o-chain', 'Escrow']],
};
const ICON = {
  'b-home': '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  'b-history': '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  'b-impact': '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
  's-node': '<rect x="6" y="4" width="12" height="18" rx="2"/><path d="M10 2h4M9 14h6M9 18h6"/>',
  's-earn': '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  's-meter': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5"/><circle cx="15.5" cy="16" r="1.5"/>',
  'g-main': '<path d="M12 5v14M5 12h14"/>',
  'o-overview': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  'o-demo': '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/>',
  'o-grid': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  'o-oracle': '<path d="M12 2 4 5v6c0 5.5 3.4 9.7 8 11 4.6-1.3 8-5.5 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  'o-chain': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  'o-momo': '<rect x="2" y="6" width="20" height="13" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/>',
};

// Small icons for stat tiles and KPI cards.
const KI = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  grid: '<path d="M12 2v4M5 6h14M7 6l-3 16M17 6l3 16M6 13h12"/>',
  battery: '<rect x="6" y="4" width="12" height="18" rx="2"/><path d="M10 2h4M9 14h6M9 18h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>',
  shield: '<path d="M12 2 4 5v6c0 5.5 3.4 9.7 8 11 4.6-1.3 8-5.5 8-11V5l-8-3Z"/><path d="M12 8v4M12 16h.01"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.7 0-3 1-3 2.2 0 2.8 6 1.4 6 4.3 0 1.3-1.3 2.3-3 2.3-1.1 0-2.2-.6-2.6-1.6M12 6v2M12 16.8V18"/>',
  split: '<path d="M12 3v18"/><path d="M12 12 5 5M12 12l7-7"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.5 11 4 4 0 0 1 17.5 19Z"/>',
  drop: '<path d="M12 2.7s6 6.5 6 11.3a6 6 0 0 1-12 0c0-4.8 6-11.3 6-11.3Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
};
const svgI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Stat tile (compact) and KPI card (bento). tone is a CSS colour token name. */
const stat = (tone, icon, label, value, sub) => `<div class="stat" style="--tone:var(--${tone})"><i class="ic">${svgI(KI[icon])}</i><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
const kpiCard = (tone, icon, label, value, sub, cls = '') => `<div class="kpi ${cls}" style="--tone:var(--${tone})"><i class="ic">${svgI(KI[icon])}</i><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
/** Tiny area sparkline for the hero card (white on the gradient). */
function sparkSVG(vals) {
  if (vals.length < 2) return '';
  const W = 300, H = 70, max = Math.max(1, ...vals);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * W).toFixed(1)} ${(H - 4 - (v / max) * (H - 10)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${W} ${H} L0 ${H}Z" fill="rgba(255,255,255,.16)"/><path d="${d}" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function viewKey() {
  if (ui.persona === 'ops') return 'ops';
  const p = PERSONAS[ui.persona];
  return p.role === ui.mode ? ui.mode : 'gate';
}

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const main = $('main'), side = $('topnav'), tabbar = $('tabbar'); // side = the page nav, now centred in the top bar
let toastT;
const receipts = mountReceiptDrawer((id) => { ui.receiptId = id; render(); });
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }

const SELLER_STATUS = { IDLE_GRID: 'Grid on, idle', CHARGING: 'Charging from solar', BATTERY_FULL: 'Full, solar curtailed', ISLAND: 'Islanded, battery standing by', EXPORTING: 'Selling to the shop', WAIT_OUTAGE: 'Trade open, waiting for outage', SOC_FLOOR: 'At the 5% reserve' };
const BUYER_STATUS = { IDLE_GRID: 'Grid on', REQUESTING: 'Requesting power', RECEIVING: 'Receiving clean power', NO_SUPPLY: 'No supply' };
const STATUS_PILL = { Open: 'warn', Settled: 'ok', Disputed: 'bad', Refunded: 'idle' };
// Stage 5B.3: the backend's own verdict for a trade (state.backend.trades). With SETTLEMENT_MODE=off a verified
// trade stays Open on-chain until it expires, so the dashboard shows the backend status instead.
const backendTrade = (id) => (state.backend?.trades || []).find((x) => x.id === Number(id)) || null;
const OFFCHAIN_DONE = ['SIMULATION_VERIFIED', 'REJECTED', 'FAILED'];
const closedOffChain = (t) => t.status === 'Open' && OFFCHAIN_DONE.includes(backendTrade(t.id)?.status);
const BACKEND_PILL = { PENDING: ['warn', 'Opening'], ACTIVE: ['warn', 'Active'], STOPPED: ['warn', 'Stopped'], AWAITING_EVIDENCE: ['warn', 'Awaiting evidence'], SIGNING: ['blue', 'Signing'], SIMULATION_VERIFIED: ['ok', 'Simulation verified'], REJECTED: ['bad', 'Rejected'], FAILED: ['bad', 'Failed'] };
/** [pill class, label] for a trade: on-chain status, or the backend verdict while it is still Open on-chain. */
function resultOf(t) {
  const bt = backendTrade(t.id);
  if (t.status === 'Open' && bt && BACKEND_PILL[bt.status]) return BACKEND_PILL[bt.status];
  if (t.status === 'Settled' && t.disputed) return ['warn', 'Resolved'];
  return [STATUS_PILL[t.status] || 'idle', t.status];
}
// Stage 6 order size: the same rules as the backend (lib/sizing.js), with the backend's own limits when known.
const lineLossOf = () => state.backend?.params?.lineLoss ?? 0.02;
const maxOrderWh = () => state.backend?.params?.maxOrderWh ?? MOMO.tradeMaxWh;
/** Trade power, counter speed and cable loss from the backend (backend/status params.orderRate, lib/sizing.js). */
const orderRate = () => ({ ...DEFAULT_RATE, ...(state.backend?.params?.orderRate || {}) });
const orderWh = () => clampOrder(ui.targetWh ?? orderSteps(orderRate()).def, maxOrderWh(), orderRate());
const orderMaxWh = () => maxWhFor(orderWh(), orderRate());
/** Order of a trade: the backend's live record, or its stored verdict. */
const orderOf = (id) => (state.backend?.active?.id === Number(id) ? state.backend.active.targetWh : backendTrade(id)?.targetWh) ?? null;
/** Live energy of a trade: METER_A's firmware counter (Stage 5B) or the gateway meters' own counts. */
function liveTradeWh(id) {
  const s = state.seller, b = state.buyer;
  if (state.backend?.stage5b?.evidence === 'wokwi-final') {
    const sent = s && s.p2pTradeId === String(id) && Number.isFinite(s.p2pTradeWh) ? s.p2pTradeWh : 0;
    return { sent, received: receivedEstimate(sent, lineLossOf()), estimate: true };
  }
  return { sent: Number(s?.tradeWh || 0), received: Number(b?.tradeWh || 0), estimate: false };
}
const fmtWh = (v) => (v == null ? '–' : Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(2));
const simLabel = (t) => (backendTrade(t.id)?.label ? '<span class="pill sim" title="Settled on Base Sepolia testnet with gateway-signed readings from the Wokwi simulation. METER_B is derived from METER_A.">Simulated testnet settlement</span>' : '');

const myTrades = (who) => tradeList().filter((t) => same(who === 'buyer' ? t.buyer : t.seller, ACCOUNTS[who].address));
const openTradeFor = (who) => myTrades(who).find((t) => t.status === 'Open' && !closedOffChain(t) && (!t.expiresAt || t.expiresAt * 1000 > Date.now()));
const withdrawableOf = (addr) => state.withdrawable[addr?.toLowerCase()] ?? null;
const pricePerWhOf = (t) => (t?.pricePerWh != null ? BigInt(t.pricePerWh) : null);
const shareBps = () => ({ util: state.totals?.utilityBps ?? 1500, plat: state.totals?.platformBps ?? 200 });

/** Seller and buyer final readings for a trade: from the dispute event, the settle event, or MQTT. */
function readingsOf(t) {
  const r = state.readings[t.id] || {};
  const f = backendTrade(t.id)?.finals || {}; // Stage 5B: unsigned firmware finals (fractional Wh)
  const sellerWh = t.sellerWh ?? (r.seller ? Number(r.seller.wh) : f.seller ? f.seller.wh : null);
  const buyerWh = t.buyerWh ?? (r.buyer ? Number(r.buyer.wh) : f.buyer ? f.buyer.wh : (t.status === 'Settled' && !t.disputed ? t.deliveredWh : null));
  return { sellerWh, buyerWh, socAfter: r.seller?.socBpsAfter ?? f.seller?.socBpsAfter ?? null, tamper: r.buyer?.tamper ?? f.buyer?.tamper ?? null };
}

function connectionNotice() {
  if (state.mqtt === 'online' && (meterOnline(METER.seller) || meterOnline(METER.buyer))) return '';
  if (state.mqtt !== 'online') {
    return `<div class="offline-card">Not connected to the MQTT broker yet (<code>${esc(MQTT_WS_URL)}</code>). Live meter data appears here once it connects.</div>`;
  }
  return `<div class="offline-card">Connected, but no meter is sending on site <code>${esc(SITE)}</code>. Start Faras's Wokwi (with the Mosquitto bridge to the public broker) and the backend (<code>cd bridge && npm run v2</code>), or the Wokwi mock (<code>npm run v2:mock</code>).</div>`;
}

/** Messages from the backend relayer (for example: Wokwi control not configured, trade held). */
function backendNotice() {
  const b = state.backend;
  if (!b) return '';
  const r = b.lastResult;
  const held = r && (r.outcome === 'HELD' || r.outcome === 'FAILED') && Date.now() - (b.updatedAt || 0) < 120000
    ? `<div class="offline-card">Trade #${esc(String(r.id))} was not settled: ${esc(r.reason || r.outcome)}. The deposit stays in escrow and can be refunded after the trade expires.</div>` : '';
  return (b.notice ? `<div class="offline-card">${esc(b.notice)}</div>` : '') + held;
}

// ------------------------------------------------------------------ rendering
let lastView = '';
const parts = new Map(); // part id -> last html

/** Replace a part's html only when it changed, and never while the user is typing inside it. */
function patch(id, html) {
  const els = document.querySelectorAll(`[data-part="${id}"]`);
  if (!els.length || parts.get(id) === html) return;
  const a = document.activeElement;
  if (a && [...els].some((el) => el.contains(a)) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
  els.forEach((el) => { el.innerHTML = html; });
  parts.set(id, html);
}

function render() {
  const k = viewKey();
  $('persona').value = ui.persona;

  let fresh = false;
  if (k + ui.persona !== lastView) { // new view: build the skeleton
    lastView = k + ui.persona;
    parts.clear();
    main.innerHTML = { buyer: buyerSkeleton, seller: sellerSkeleton, gate: gateSkeleton, ops: opsSkeleton }[k]();
    renderNav(k);
    ui.page = pageFromHash(k);
    syncHash();
    window.scrollTo({ top: 0 });
    fresh = true;
  }
  renderHeader();
  ({ buyer: buyerParts, seller: sellerParts, gate: gateParts, ops: opsParts })[k]();
  if (fresh) showPage();
}

function renderNav(k) {
  const items = NAV[k];
  const link = ([id, label]) => `<a href="#${id}" data-go="${id}">${svgI(ICON[id])}<span>${label}</span></a>`;
  side.innerHTML = items.length < 2 ? '' : `<span class="side-ind" aria-hidden="true"></span>${items.map(link).join('')}`;
  tabbar.hidden = items.length < 2;
  tabbar.innerHTML = items.map(link).join('');
}

// ------------------------------------------------------------------ pages (one sidebar item = one page)
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pageFromHash = (k) => { const h = location.hash.slice(1); return NAV[k].some(([id]) => id === h) ? h : NAV[k][0][0]; };
function syncHash() { if (location.hash !== '#' + ui.page) history.replaceState(null, '', `${location.pathname}${location.search}#${ui.page}`); }

function showPage() {
  main.querySelectorAll('.view').forEach((v) => {
    const on = v.dataset.view === ui.page;
    v.classList.toggle('on', on);
    v.classList.remove('enter');
    if (on && !reduceMotion) { void v.offsetWidth; v.classList.add('enter'); countUp(v); }
  });
  markNav();
}
function markNav() {
  [...side.querySelectorAll('a[data-go]'), ...tabbar.querySelectorAll('a[data-go]')].forEach((a) => {
    const on = a.dataset.go === ui.page;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  moveIndicator();
}
function moveIndicator() {
  const a = side.querySelector('a.on'), ind = side.querySelector('.side-ind');
  if (!a || !ind) return;
  ind.style.width = `${a.offsetWidth}px`;
  ind.style.transform = `translateX(${a.offsetLeft}px)`;
}
function go(id) {
  if (id === ui.page) return;
  ui.page = id;
  history.pushState(null, '', `${location.pathname}${location.search}#${id}`);
  showPage();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}
addEventListener('popstate', () => { const id = pageFromHash(viewKey()); if (id !== ui.page) { ui.page = id; showPage(); } });
addEventListener('resize', moveIndicator);
side.addEventListener('click', (e) => { const a = e.target.closest('a[data-go]'); if (!a) return; e.preventDefault(); go(a.dataset.go); });

/** Numbers in stat tiles and KPI cards count up when a page opens. */
function countUp(root) {
  root.querySelectorAll('.kpi b, .stat b, .big-num').forEach((el) => {
    const tn = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
    if (!tn) return;
    const m = tn.nodeValue.match(/\d[\d,]*(\.\d+)?/);
    if (!m) return;
    const target = parseFloat(m[0].replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const dec = m[1] ? m[1].length - 1 : 0;
    const pre = tn.nodeValue.slice(0, m.index), post = tn.nodeValue.slice(m.index + m[0].length), final = tn.nodeValue;
    const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: m[0].includes(',') });
    const t0 = performance.now();
    const step = (now) => {
      if (!tn.isConnected) return;
      const p = Math.min(1, (now - t0) / 900);
      tn.nodeValue = p < 1 ? pre + fmt(target * (1 - (1 - p) ** 3)) + post : final;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

const WALLET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><circle cx="16.5" cy="13.5" r="1.5"/></svg>';
function renderHeader() {
  const metersUp = [METER.seller, METER.buyer].filter(meterOnline).length;
  const mq = state.mqtt === 'online' ? (metersUp ? 'on' : 'warn') : state.mqtt === 'connecting' ? 'warn' : 'off';
  const mqText = state.mqtt === 'online' ? (metersUp ? `Meters live ${metersUp}/2` : 'No meters') : state.mqtt === 'connecting' ? 'MQTT…' : 'MQTT offline';
  const ch = state.chain === 'online' ? 'on' : state.chain === 'connecting' ? 'warn' : 'off';
  const chText = state.chain === 'online' ? `Block ${state.block.toLocaleString('en-US')}` : state.chain === 'connecting' ? 'Chain…' : 'Chain offline';
  $('chips').innerHTML = `<span class="chip ${mq}" title="MQTT ${esc(MQTT_WS_URL)} · site ${esc(SITE)}">${mqText}</span><a class="chip ${ch} hide-m" href="${addrUrl(CHAIN.escrow)}" target="_blank" rel="noopener" title="${esc(state.chainError || 'AegisEscrow on Base Sepolia')}">${chText}</a>`;
  const live = state.mqtt === 'online' && metersUp && state.chain === 'online' ? ['ok', 'Live']
    : state.mqtt === 'connecting' || state.chain === 'connecting' ? ['warn', 'Connecting']
    : state.mqtt === 'online' || state.chain === 'online' ? ['warn', 'Partly live'] : ['off', 'Offline'];
  $('liveBtn').className = `live ${live[0]}`;
  $('liveText').textContent = live[1];
  $('liveBtn').title = `${mqText} · ${chText}`;
  const gs = $('gridStatus');
  gs.hidden = !state.grid;
  gs.textContent = state.grid === 'OUTAGE' ? 'Load shedding' : 'Grid normal';
  gs.className = 'status ' + (state.grid === 'OUTAGE' ? 'bad' : 'ok');
  $('clock').textContent = simClock(state.seller?.simMin ?? state.buyer?.simMin);
  const wb = $('walletBtn');
  if (state.wallet) {
    const who = [['buyer', ACCOUNTS.buyer], ['seller', ACCOUNTS.seller]].find(([, a]) => same(a.address, state.wallet.address));
    const isOwner = same(state.totals?.owner, state.wallet.address);
    wb.innerHTML = `${WALLET_ICON}<span class="w-text">${short(state.wallet.address)}</span><span class="w-role">${who ? ` · ${who[0]}` : isOwner ? ' · owner' : ''}</span>`;
    wb.classList.add('connected');
  } else {
    wb.innerHTML = `${WALLET_ICON}<span class="w-text">${hasWallet() ? 'Connect wallet' : 'No wallet'}</span>`;
    wb.classList.remove('connected');
  }
}

/**
 * Balance card at the top of the buyer and seller pages: the simulated MoMo total and the real
 * on-chain balance. The on-chain row always offers a wallet action, so the wallet is reachable from
 * the page itself (Withdraw connects the wallet first if needed).
 */
function walletChip({ momoLabel, momoAmount, phone, chainLabel, bal }) {
  const busy = ui.busy === 'withdraw' || ui.busy === 'connect';
  const action = bal != null && bal > 0n
    ? `<button class="btn btn-green btn-sm" type="button" data-act="withdraw" ${busy ? 'disabled' : ''}>${ui.busy === 'withdraw' ? 'Confirm…' : 'Withdraw'}</button>`
    : state.wallet ? '' : `<button class="btn btn-line btn-sm" type="button" data-act="connect" ${busy ? 'disabled' : ''}>${ui.busy === 'connect' ? 'Check wallet…' : 'Connect'}</button>`;
  return `<div class="wc-row"><span class="momo-dot" aria-hidden="true">M</span><span title="${esc(phone)} · simulated mobile money">${momoLabel}</span><b class="mono">${fiat(momoAmount)}</b></div>
    <div class="wc-row"><span class="wc-eth" aria-hidden="true">Ξ</span><span title="Test ETH held by the escrow contract for this account">${chainLabel}</span><b class="mono">${money(bal)}</b>${action}</div>`;
}

// ================================================================== BUYER
function buyerSkeleton() {
  return `
  <div class="page-h"><div><h1>Hello, <span>${esc(greetName())}</span></h1><p data-part="b-sub"></p></div><div class="wallet-chip" data-part="b-wallet"></div></div>
  <div data-part="b-banner"></div>
  <div data-part="b-notice"></div>
  <div class="view" data-view="b-home">
    <section class="stats" data-part="b-stats"></section>
    <section class="grid g-main">
      <div class="panel hero-panel" data-part="b-action"></div>
      <div class="panel" data-part="b-receipt"></div>
    </section>
  </div>
  <div class="view" data-view="b-history">
    <section class="panel"><div class="ph"><h2>Receipts</h2><small>Trades where you are the buyer</small></div><div data-part="b-list"></div></section>
  </div>
  <div class="view" data-view="b-impact">
    <section class="bento" data-part="b-impact"></section>
  </div>`;
}

function buyerParts() {
  const buyer = state.buyer, seller = state.seller;
  const outage = state.grid === 'OUTAGE';
  patch('b-sub', state.grid ? (outage ? 'Load shedding is active. The street microgrid is islanded.' : 'Your shop has grid power right now.') : 'Waiting for the meters to report the grid status.');

  const bal = withdrawableOf(ACCOUNTS.buyer.address);
  const buyerMomo = myTrades('buyer').flatMap((x) => momoForTrade(x, shareBps())).filter((r) => r.kind === 'refund').reduce((x, r) => x + (r.amount || 0), 0);
  patch('b-wallet', walletChip({ momoLabel: 'MoMo refunds', momoAmount: buyerMomo, phone: MOMO.buyerPhone, chainLabel: 'Refund on-chain', bal }));

  patch('b-banner', !state.grid ? '' : outage
    ? `<div class="banner bad"><div><b>Load shedding on this feeder</b>A seller's battery next door can power your shop instead of a generator.</div></div>`
    : `<div class="banner ok"><div><b>Grid power is on</b>Requests open during load shedding. For the demo you can start an outage here.</div><button class="btn btn-dark" type="button" data-act="outage-on">Start load shedding (demo)</button></div>`);
  patch('b-notice', connectionNotice() + backendNotice());

  const settledMine = myTrades('buyer').filter((x) => x.status === 'Settled');
  patch('b-stats', [
    stat(outage ? 'rose' : 'green', 'grid', 'Grid', outage ? 'Load shedding' : state.grid ? 'On' : '–', 'feeder status'),
    stat('teal', 'battery', 'Neighbour battery', seller ? pct(seller.socBps) : '–', seller ? esc(SELLER_STATUS[seller.status] || seller.status) : 'no data'),
    stat('sky', 'bolt', 'Receiving now', watts(buyer?.importW), buyer ? esc(BUYER_STATUS[buyer.status] || buyer.status) : 'no data'),
    stat('violet', 'check', 'Trades settled', String(settledMine.length), `${wh(settledMine.reduce((a, x) => a + (x.deliveredWh || 0), 0))} bought`),
  ].join(''));

  // --- the request / live session card, driven by real telemetry and events
  const open = openTradeFor('buyer');
  const tradeId = Number(buyer?.tradeId || 0) || open?.id || 0;
  const t = tradeId ? state.trades[tradeId] : null;
  const rd = tradeId ? state.readings[tradeId] || {} : {};
  let html;
  const requesting = buyer?.requesting || state.backend?.requests?.app;
  if (requesting && !tradeId) {
    html = openingCardHTML({ targetWh: state.backend?.requests?.app ? orderWh() : null });
  } else if (tradeId && (requesting || buyer?.status === 'RECEIVING')) {
    const price = pricePerWhOf(t);
    const live = liveTradeWh(tradeId);
    const got = live.received;
    html = liveSessionHTML({
      tradeId,
      statusTone: buyer?.status === 'RECEIVING' ? 'ok' : 'warn',
      statusText: esc(BUYER_STATUS[buyer?.status] || buyer?.status || 'Starting'),
      importW: Number(buyer?.importW || 0),
      batteryText: seller ? pct(seller.socBps) : '',
      targetWh: orderOf(tradeId),
      receivedWh: got,
      estimate: live.estimate,
      costText: `${fiat(whToFiat(got))} <small class="muted">· ${price != null ? money(BigInt(Math.floor(got)) * price) : '–'}</small>`,
      depositText: fiat(depositFiat(t?.maxWh)),
      escrowText: t?.maxWh && price != null ? `${money(BigInt(t.maxWh) * price)} <small class="muted">· ${t.maxWh} Wh</small>` : '–',
      unservedText: watts(buyer?.unservedW),
      openTxHtml: t?.openTx ? `<a class="ext" href="${txUrl(t.openTx)}" target="_blank" rel="noopener">${shortHash(t.openTx)}</a>` : 'waiting for event…',
    });
  } else if (tradeId && t?.status === 'Open' && !closedOffChain(t)) {
    const bt = backendTrade(tradeId);
    const fin = bt?.finals || {};
    html = closingCardHTML({
      tradeId,
      sellerWh: rd.seller ? rd.seller.wh : fin.seller?.wh ?? null,
      buyerWh: rd.buyer ? rd.buyer.wh : fin.buyer?.wh ?? null,
      testnet: state.backend?.stage5b?.settlementMode === 'testnet',
      orderReached: bt?.stopReason === 'order reached',
      targetWh: orderOf(tradeId),
      fmtWh,
    });
  } else if (ui.momo) {
    html = momoCheckoutHTML({ step: ui.momo, amountText: fiat(depositFiat(orderMaxWh())), targetWh: orderWh(), maxWh: orderMaxWh(), phone: MOMO.buyerPhone, esc });
  } else {
    html = requestCardHTML({
      outage,
      canRequest: outage && state.mqtt === 'online',
      targetWh: orderWh(),
      maxOrderWh: maxOrderWh(),
      maxWh: orderMaxWh(),
      depositText: fiat(depositFiat(orderMaxWh())),
      rateText: fiat(MOMO.pricePerKWh),
      priceText: fiat(whToFiat(orderWh())),
      generatorText: fiat(generatorFiat(orderWh(), IMPACT.dieselLPerKWh)),
      rate: orderRate(),
    });
  }
  patch('b-action', html);

  // --- last receipt
  const closed = myTrades('buyer').filter((x) => x.status !== 'Open' || closedOffChain(x));
  patch('b-receipt', closed.length ? receiptHTML(closed[0]) : `<div class="ph"><h2>Last receipt</h2></div><p class="empty">Your receipt appears here after a trade settles: both meter readings, the split and the transaction.</p>`);
  patch('b-list', tradesTable(myTrades('buyer'), 'buyer'));

  const deliveredMine = myTrades('buyer').filter((x) => x.status === 'Settled').reduce((a, x) => a + (x.deliveredWh || 0), 0);
  const im = impact(deliveredMine);
  patch('b-impact', `
    <div class="kpi hero" style="--tone:var(--green)"><i class="ic">${svgI(KI.leaf)}</i><span>Clean energy you bought</span><b>${wh(deliveredMine)}</b><em>settled on-chain, from a neighbour's battery instead of a generator</em></div>
    ${kpiCard('sun', 'drop', 'Diesel avoided', `${im.litres.toFixed(2)}<small>L</small>`, 'assumed generator use')}
    ${kpiCard('sky', 'cloud', 'CO₂ avoided', `${im.co2Kg.toFixed(2)}<small>kg</small>`, 'assumed emission factor')}
    <div class="kpi wide" style="--tone:var(--violet)"><i class="ic">${svgI(KI.info)}</i><span>How this is counted</span><p class="method">${IMPACT.dieselLPerKWh} L of diesel per kWh a generator would have made, and ${IMPACT.co2KgPerL} kg of CO₂ per litre burned. Both are assumptions until the team cites sources. Energy comes from trades settled on Base Sepolia.</p></div>`);
}

function receiptHTML(t) {
  const { sellerWh, buyerWh, tamper } = readingsOf(t);
  const tol = (t.toleranceBps ?? state.totals?.toleranceBps ?? 300) / 100;
  const bt = backendTrade(t.id);
  return buyerReceiptHTML(t.id, {
    pill: t.status === 'Settled' ? ['ok', t.disputed ? 'Resolved · paid' : 'Verified · paid'] : t.status === 'Disputed' ? ['bad', 'Disputed · funds frozen'] : resultOf(t),
    simLabelHtml: simLabel(t),
    sellerWh, buyerWh, tamper, tol, fmtWh,
    signedTxt: bt && !bt.label ? 'Wh · meter final' : 'Wh · signed',
    gap: sellerWh != null && buyerWh != null ? gapPct(sellerWh, buyerWh) : null,
    targetWh: bt?.targetWh ?? null,
    settledRowHtml: t.status === 'Settled' ? `<div class="row"><span>Paid for ${wh(t.deliveredWh)}</span><b>${money(t.amount)}</b></div>` : '',
    outcomeHtml: t.status === 'Settled' ? `<div class="split">
      <div style="background:var(--green-soft)"><span>Seller</span><b>${money(t.sellerShare)}</b></div>
      <div style="background:var(--blue-soft)"><span>Utility fee</span><b>${money(t.utilityShare)}</b></div>
      <div style="background:var(--amber-soft)"><span>Aegis fee</span><b>${money(t.platformShare)}</b></div></div>
      <div class="row" style="border:0;padding:0"><span>Unused deposit back to buyer</span><b>${money(t.buyerRefund)}</b></div>`
      : t.status === 'Disputed' ? `<p style="margin:0;font-size:13.5px;color:#7F1D1D">The two meters disagree by more than ${tol}%. The escrow keeps the deposit until the arbiter resolves it, or refunds the buyer after the dispute window.</p>`
      : t.status === 'Refunded' ? `<div class="row" style="border:0;padding:0"><span>Refunded to buyer</span><b>${money(t.refundAmount)}</b></div>`
      : bt?.status === 'SIMULATION_VERIFIED' ? `<p style="margin:0;font-size:13.5px;color:var(--muted)">Both Wokwi meters agree within ${tol}%. Settlement is switched off for simulated readings, so nothing was paid. The deposit returns to you when the trade expires.</p>`
      : bt?.status === 'REJECTED' || bt?.status === 'FAILED' ? `<p style="margin:0;font-size:13.5px;color:#7F1D1D">Not settled: ${esc(bt.reason || 'the evidence failed a check')}. Nothing was paid; the deposit returns to you when the trade expires.</p>` : '',
    momoHtml: momoBlock(t),
    savedHtml: t.status === 'Settled' ? `<div class="row"><span>Saved vs a diesel generator</span><b style="color:var(--green)">${fiat(Math.max(0, generatorFiat(t.deliveredWh, IMPACT.dieselLPerKWh) - whToFiat(t.deliveredWh)))}</b></div>` : '',
    chainHtml: chainButtonHTML({ openTx: t.openTx, settleTx: t.settleTx, refundTx: t.refundTx, txUrl }),
  });
}

const MOMO_STATUS = { SUCCESSFUL: ['ok', 'Successful'], PENDING: ['warn', 'Pending'], HELD: ['bad', 'Held'] };
function momoPill(st) { const [c, l] = MOMO_STATUS[st] || ['idle', st]; return `<span class="pill ${c}">${l}</span>`; }

/** Simulated mobile-money lines for a buyer receipt. */
function momoBlock(t) {
  const recs = momoForTrade(t, shareBps()).filter((r) => r.kind === 'deposit' || r.kind === 'refund');
  return `<div class="momo-box"><div class="momo-head"><span class="momo-dot" aria-hidden="true">M</span><b>Mobile money</b><span class="pill sim">Simulated</span></div>
    ${recs.map((r) => `<div class="row"><span>${r.label} <small class="mono muted">${r.ref}</small></span><b>${r.amount != null ? fiat(r.amount) : '–'} ${momoPill(r.status)}</b></div>`).join('')}
    ${t.status === 'Disputed' ? '<p class="note" style="margin-top:6px">Your deposit stays on hold until the arbiter decides. Nothing is paid out meanwhile.</p>' : ''}</div>`;
}

function tradesTable(list, who) {
  if (!state.historyLoaded && state.chain !== 'offline') return `<p class="empty">Loading trades from the contract…</p>`;
  if (state.chain === 'offline' && !list.length) return `<p class="empty">Cannot reach the chain right now (${esc(state.chainError || 'RPC offline')}). Retrying.</p>`;
  if (!list.length) return `<p class="empty">No trades yet.</p>`;
  const rows = list.slice(0, 30).map((t) => {
    const { sellerWh, buyerWh } = readingsOf(t);
    const gap = sellerWh != null && buyerWh != null ? gapPct(sellerWh, buyerWh) : null;
    const amount = t.status === 'Settled' ? (who === 'seller' ? t.sellerShare : t.amount) : null;
    return `<tr class="${t.status === 'Disputed' ? 'flag' : ''}">
      <td data-label="Trade" class="mono">#${t.id}</td>
      <td data-label="Opened">${clock(t.openTime)}</td>
      <td data-label="Order" class="num">${backendTrade(t.id)?.targetWh ?? '–'}</td>
      <td data-label="Seller sent" class="num">${fmtWh(sellerWh)}</td>
      <td data-label="Shop received" class="num">${fmtWh(buyerWh)}</td>
      <td data-label="Difference" class="num">${gap == null ? '–' : gap.toFixed(1) + '%'}</td>
      <td data-label="${who === 'seller' ? 'Your share' : 'Paid'}" class="num">${amount != null ? money(amount) : '–'}</td>
      <td data-label="Status"><span class="pill ${resultOf(t)[0]}">${resultOf(t)[1]}</span></td>
      <td data-label="Tx">${(t.settleTx || t.openTx) ? `<a class="ext" href="${txUrl(t.settleTx || t.openTx)}" target="_blank" rel="noopener">${shortHash(t.settleTx || t.openTx)}</a>` : '–'}</td></tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table><thead><tr><th>Trade</th><th>Opened</th><th class="num">Order (Wh)</th><th class="num">Seller sent (Wh)</th><th class="num">Shop received (Wh)</th><th class="num">Difference</th><th class="num">${who === 'seller' ? 'Your share' : 'Paid'}</th><th>Status</th><th>Tx</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ================================================================== SELLER
function sellerSkeleton() {
  return `
  <div class="page-h"><div><h1>My <span>battery</span></h1><p>Meter ${METER.seller} · ${short(ACCOUNTS.seller.address)}</p></div><div class="wallet-chip" data-part="s-wallet"></div></div>
  <div data-part="s-notice"></div>
  <div class="view" data-view="s-node">
    <section class="stats" data-part="s-stats"></section>
    <section class="grid g-main">
      <div class="panel hero-panel" data-part="s-battery"></div>
      <div class="panel" data-part="s-selling"></div>
    </section>
  </div>
  <div class="view" data-view="s-earn">
    <section class="grid g-main">
      <div class="panel" data-part="s-earnings"></div>
      <div class="panel" data-part="s-solar"></div>
    </section>
    <section class="panel" data-part="s-trades"></section>
  </div>
  <div class="view" data-view="s-meter">
    <section class="panel narrow" data-part="s-meter"></section>
  </div>`;
}

function sellerParts() {
  const s = state.seller;
  const bal = withdrawableOf(ACCOUNTS.seller.address);
  const sellerMomo = myTrades('seller').flatMap((x) => momoForTrade(x, shareBps())).filter((r) => r.kind === 'payout').reduce((x, r) => x + (r.amount || 0), 0);
  patch('s-wallet', walletChip({ momoLabel: 'Paid to your MoMo', momoAmount: sellerMomo, phone: MOMO.sellerPhone, chainLabel: 'Earnings on-chain', bal }));
  patch('s-notice', connectionNotice());

  const settledS = myTrades('seller').filter((x) => x.status === 'Settled');
  patch('s-stats', [
    stat('sun', 'sun', 'Solar now', watts(s?.pvW), s ? `charging ${watts(s.chargeW)}` : 'no data'),
    stat('sky', 'home', 'Community load', watts(s?.loadW), s ? (s.grid === 'OUTAGE' ? (s.backupAllowed ? 'emergency backup on' : 'islanded, backup off') : 'grid on') : 'no data'),
    stat('green', 'bolt', 'Selling now', watts(s?.exportW), s && Number(s.exportW) > 0.1 ? 'to the buyer\'s shop' : 'idle'),
    stat('violet', 'check', 'Trades settled', String(settledS.length), `${wh(settledS.reduce((a, x) => a + (x.deliveredWh || 0), 0))} sold`),
  ].join(''));

  const soc = s ? Number(s.socBps) / 100 : null;
  patch('s-battery', `<div class="ph"><h2>State of charge</h2><span class="pill ${s?.status === 'EXPORTING' ? 'ok' : s?.status === 'CHARGING' ? 'warn' : 'idle'}">${esc(SELLER_STATUS[s?.status] || (s ? s.status : 'No data'))}</span></div>
    <div class="batt-wrap">
      <div class="cell" aria-hidden="true"><div class="lvl" style="height:calc((100% - 12px)*${(soc ?? 0) / 100})"></div>
        <div class="band" style="bottom:calc(6px + (100% - 12px)*.05)"><span>5%</span></div></div>
      <div>
        <div class="soc">${soc != null ? soc.toFixed(1) : '–'}<small>%</small></div>
        <div class="rows" style="margin-top:12px">
          <div class="row"><span>Stored energy</span><b>${s ? wh(s.batteryWh) : '–'}</b></div>
          <div class="row"><span>Battery reserve</span><b>${s?.minSocPct ?? 5}%</b></div>
          <div class="row"><span>Community load</span><b>${watts(s?.loadW)}</b></div>
          <div class="row"><span>Grid</span><b>${s ? (s.grid === 'OUTAGE' ? 'Off · islanded' : 'On') : '–'}</b></div>
        </div>
      </div>
    </div>`);

  const open = openTradeFor('seller');
  const exporting = s && Number(s.exportW) > 0.1;
  const tid = Number(s?.tradeId || 0) || open?.id;
  const t = tid ? state.trades[tid] : null;
  const price = pricePerWhOf(t);
  const { util, plat } = shareBps();
  const sent = tid ? liveTradeWh(tid).sent : 0;
  const order = tid ? orderOf(tid) : null;
  patch('s-selling', exporting || tid
    ? `<div class="ph"><h2>Selling now · trade #${tid}</h2><span class="pill ${exporting ? 'ok' : 'warn'}">${exporting ? 'Discharging' : esc(SELLER_STATUS[s?.status] || 'Open')}</span></div>
      <div class="live-num"><b class="mono">${Math.round(Number(s?.exportW || 0))}</b><span>W to the buyer's shop</span></div>
      <div class="flowbar" aria-hidden="true" style="margin:14px 0"><i></i></div>
      <div class="rows">${order ? `<div class="row"><span>Shop's order</span><b>${order} Wh received</b></div>` : ''}<div class="row"><span>Sent this trade</span><b>${sent.toFixed(1)} Wh</b></div>
        <div class="row"><span>Your share so far (est.)</span><b>${price != null ? money((BigInt(Math.floor(sent * 0.98)) * price * BigInt(10000 - util - plat)) / 10000n) : '–'}</b></div>
        <div class="row"><span>Battery reserve</span><b>stops at ${s?.minSocPct ?? 5}%</b></div></div>
      <p class="note">You are paid for what the shop's meter receives (about 2% less than you send, cable loss).</p>`
    : `<div class="ph"><h2>Selling now</h2><span class="pill idle">${state.grid === 'OUTAGE' ? 'Waiting for a request' : 'Grid on'}</span></div>
      <p style="margin:0;color:var(--muted)">${state.grid === 'OUTAGE' ? 'Your battery is ready. When the shop requests power, the bridge opens a trade and your meter starts exporting.' : 'Your battery sells only during load shedding, inside the islanded street microgrid.'}</p>`);

  const mine = myTrades('seller');
  const settled = mine.filter((x) => x.status === 'Settled');
  const earned = settled.reduce((a, x) => a + BigInt(x.sellerShare || 0), 0n);
  const canWithdraw = bal != null && bal > 0n;
  const isMe = same(state.wallet?.address, ACCOUNTS.seller.address);
  patch('s-earnings', `<div class="ph"><h2>Earnings</h2><small>${settled.length} settled trade${settled.length === 1 ? '' : 's'}</small></div>
    <div class="big-num">${money(earned)}<small>total earned on-chain</small></div>
    <div class="rows">
      <div class="row"><span>Total earned (seller share, ${(10000 - util - plat) / 100}%)</span><b>${money(earned)}</b></div>
      <div class="row"><span>Energy sold</span><b>${wh(settled.reduce((a, x) => a + (x.deliveredWh || 0), 0))}</b></div>
      <div class="row"><span>In the contract, ready to withdraw</span><b>${money(bal)}</b></div>
    </div>
    <div class="momo-box" style="margin-top:12px"><div class="momo-head"><span class="momo-dot" aria-hidden="true">M</span><b>Paid to your MoMo</b><span class="pill sim">Simulated</span></div>
      <div class="row"><span>${esc(MOMO.sellerPhone)}</span><b>${fiat(settled.reduce((a, x) => a + (momoForTrade(x, shareBps()).find((r) => r.kind === 'payout')?.amount || 0), 0))}</b></div>
      ${settled.slice(0, 4).map((x) => { const r = momoForTrade(x, shareBps()).find((q) => q.kind === 'payout'); return `<div class="row"><span>Trade #${x.id} <small class="mono muted">${r.ref}</small></span><b>${fiat(r.amount)} ${momoPill(r.status)}</b></div>`; }).join('')}
      ${open ? `<div class="row"><span>Trade #${open.id}</span><b>after settlement ${momoPill('PENDING')}</b></div>` : ''}
    </div>
    <button class="btn btn-green" type="button" data-act="withdraw" style="margin-top:12px;width:100%" ${canWithdraw && ui.busy !== 'withdraw' ? '' : 'disabled'}>${ui.busy === 'withdraw' ? 'Confirm in your wallet…' : 'Withdraw earnings'}</button>
    <p class="note">${isMe ? 'Connected as the seller account.' : `Withdraw sends the transaction from your wallet: connect the seller account <b>${short(ACCOUNTS.seller.address)}</b>.`}</p>`);
  patch('s-trades', `<div class="ph"><h2>Your trades</h2><small>latest ${Math.min(6, mine.length)}</small></div>${tradesTable(mine.slice(0, 6), 'seller')}`);

  patch('s-solar', `<div class="ph"><h2>Solar right now</h2><small>Simulated meter</small></div>
    <div class="rows">
      <div class="row"><span>Solar output</span><b>${watts(s?.pvW)}</b></div>
      <div class="row"><span>Charging the battery</span><b>${watts(s?.chargeW)}</b></div>
      <div class="row"><span>Surplus curtailed (wasted)</span><b style="color:${Number(s?.curtailedW) > 0 ? 'var(--alert)' : 'inherit'}">${watts(s?.curtailedW)}</b></div>
      <div class="row"><span>Battery to community (backup)</span><b>${watts(s?.dischargeLocalW)}</b></div>
      <div class="row"><span>Exported over the line</span><b>${watts(s?.exportW)}</b></div>
      <div class="row"><span>Lifetime export (meter)</span><b>${s ? wh(s.exportWhTotal) : '–'}</b></div>
    </div>`);

  const meter = state.meters[ACCOUNTS.seller.address.toLowerCase()];
  patch('s-meter', `<div class="ph"><h2>Smart meter</h2><span class="pill ${meter ? 'ok' : 'warn'}">${meter ? 'Registered on-chain' : 'Not registered'}</span></div>
    <div class="rows">
      <div class="row"><span>Meter id</span><b>${METER.seller}</b></div>
      <div class="row"><span>Signing key on the contract</span><b>${meter ? `<a class="ext" href="${addrUrl(meter)}" target="_blank" rel="noopener">${short(meter)}</a>` : '–'}</b></div>
      <div class="row"><span>Telemetry</span><b>${meterOnline(METER.seller) ? 'live, 1 per second' : 'offline'}</b></div>
    </div>
    <p class="note">Every final reading is signed with this key (EIP-712) and checked by the escrow contract. In this prototype the key is held by the bridge; production meters keep it in a secure element.</p>`);
}

// ================================================================== GATE (role this persona does not have)
function gateSkeleton() {
  return `<div class="page-h"><div><h1 data-part="g-title"></h1><p data-part="g-sub"></p></div></div>
  <section class="panel gate" id="g-main" data-part="g-main"></section>`;
}

function gateParts() {
  if (ui.persona === 'ama') { // shop wants to sell
    patch('g-title', 'Start selling your stored power');
    patch('g-sub', 'Turn a home battery into income during blackouts.');
    const me = state.wallet?.address;
    const meter = me ? state.meters[me.toLowerCase()] : null;
    patch('g-main', `<ol class="steps">
        <li><div><b>Install an Aegis smart meter</b><span>A certified installer fits it between the inverter and the battery. It signs every reading.</span></div></li>
        <li><div><b>Register the meter's signing key</b><span>Calls <code>registerMeter(meter)</code> on the escrow contract from your wallet.</span></div></li>
        <li><div><b>Sell during load shedding</b><span>The bridge matches a nearby shop and the contract pays you after both meters agree.</span></div></li>
      </ol>
      <div>
        <div class="rows"><div class="row"><span>Your wallet</span><b>${me ? short(me) : 'not connected'}</b></div>
          <div class="row"><span>Meter registered for this wallet</span><b>${me ? (meter ? `<a class="ext" href="${addrUrl(meter)}" target="_blank" rel="noopener">${short(meter)}</a>` : 'none yet') : '–'}</b></div></div>
        <form class="form" data-form="register"><input id="meterAddr" name="meter" placeholder="Meter signing address 0x…" autocomplete="off" spellcheck="false" aria-label="Meter signing address">
          <button class="btn btn-dark" type="submit" ${ui.busy === 'register' ? 'disabled' : ''}>${ui.busy === 'register' ? 'Confirm in wallet…' : 'Register meter'}</button></form>
        <p class="note">Testnet only. The prototype trades between the two demo households; registering here proves the onboarding call works from any wallet.</p>
      </div>`);
  } else { // seller in buyer mode
    patch('g-title', 'Buying power as the seller');
    patch('g-sub', 'This demo household is the seller in the prototype.');
    patch('g-main', `<p style="margin:0">The contract lets any registered account buy, but in the demo the bridge holds the testnet key of the shop (Household B) and opens trades for it. Switch to the <b>demo shop</b> to see the buyer side, or back to <b>Seller</b> for the battery.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn btn-green" type="button" data-act="as-ama">View as buyer</button><button class="btn btn-line" type="button" data-act="mode-seller">Back to seller</button></div>`);
  }
}

// ================================================================== OPERATOR
function opsSkeleton() {
  return `
  <div data-part="o-notice"></div>
  <div class="view" data-view="o-overview">
    <section class="bento" data-part="o-kpis"></section>
    <section class="grid g-main">
      <div class="panel chart"><div class="ph"><h2>Power on the microgrid</h2><small>Live telemetry, last 5 minutes</small></div><div data-part="o-chart"></div>
        <div class="legend"><span><i style="background:#F59E0B"></i>Solar</span><span><i style="background:#16A34A"></i>Battery → shop</span><span><i style="background:#2563EB"></i>Shop received</span><span><i style="background:#E5484D"></i>Curtailed / unserved</span><span><i style="background:#FEE2E2"></i>Outage</span></div></div>
      <div class="panel" data-part="o-quick"></div>
    </section>
  </div>
  <div class="view" data-view="o-grid">
    <section class="grid g-ctl">
      <div class="panel demo cr-ctl">
        <div class="ph cr-head"><div class="cr-title" data-part="o-ctl-head"></div><div class="cr-engine" data-engine></div></div>
        <div class="cr-sliders" data-part="o-ctl-sliders"></div>
        <div data-part="o-ctl-toggles"></div>
        <div data-part="o-ctl-foot"></div>
      </div>
      <div class="panel cr-metrics" data-part="o-metrics"></div>
    </section>
  </div>
  <div class="view" data-view="o-oracle">
    <section class="panel"><div class="ph"><h2>Dual-meter oracle</h2><small data-part="o-oracle-sub"></small></div><div data-part="o-oracle"></div></section>
  </div>
  <div class="view" data-view="o-momo">
    <section class="panel" data-part="o-momo"></section>
  </div>
  <div class="view" data-view="o-chain">
    <section class="grid g2">
      <div class="panel" data-part="o-escrow"></div>
      <div class="panel" data-part="o-balances"></div>
    </section>
  </div>`;
}

function opsParts() {
  patch('o-notice', connectionNotice());
  const T = state.totals;
  const list = tradeList();
  const settled = list.filter((t) => t.status === 'Settled');
  const disputed = list.filter((t) => t.disputed);
  const sum = (k) => settled.reduce((a, t) => a + BigInt(t[k] || 0), 0n);
  const im = impact(T?.totalDeliveredWh || 0);
  patch('o-kpis', `
    <div class="kpi hero" style="--tone:var(--green)"><i class="ic">${svgI(KI.bolt)}</i><span>Energy delivered</span><b>${T ? wh(T.totalDeliveredWh) : '–'}</b>
      <em>on-chain totalDeliveredWh · about ${im.litres.toFixed(2)} L diesel avoided (assumption)</em>
      ${sparkSVG(state.history.slice(-120).map((p) => p.exportW))}<small class="spark-l">${state.history.length > 1 ? 'Battery → shop, live' : ''}</small></div>
    ${kpiCard('sky', 'swap', 'Trades', T ? String(T.nextTradeId - 1) : '–', `${settled.length} settled`)}
    ${kpiCard('rose', 'shield', 'Disputes caught', String(disputed.length), `${list.filter((t) => t.status === 'Disputed').length} still frozen`)}
    ${kpiCard('violet', 'coin', 'Paid for energy', money(sum('amount')), 'test ETH')}
    ${kpiCard('sun', 'split', 'Utility + platform fees', money(sum('utilityShare') + sum('platformShare')), `${pct(T?.utilityBps)} + ${pct(T?.platformBps)}`)}`);

  patch('o-chart', chartSVG());

  // control room (bridge/src/v2 + Faras's Stage 4E): see control-room.js
  patch('o-quick', quickHTML());
  patch('o-ctl-head', ctlHead());
  syncEngineSwitch(document.querySelectorAll('[data-engine]'));
  patch('o-ctl-sliders', ctlSliders());
  patch('o-ctl-toggles', ctlToggles());
  patch('o-ctl-foot', ctlFoot());
  patch('o-metrics', metricsHTML());

  const oracle = list.slice(0, 12);
  patch('o-oracle-sub', `tolerance ${pct(T?.toleranceBps ?? 300)} · ${list.length} trades · click a trade for its receipt`);
  const isOwner = same(state.wallet?.address, T?.owner);
  patch('o-oracle', !list.length ? (state.historyLoaded ? '<p class="empty">No trades yet.</p>' : '<p class="empty">Loading trades from the contract…</p>') :
    `<div class="tbl-wrap"><table><thead><tr><th>Trade</th><th>Opened</th><th class="num">Order (Wh)</th><th class="num">Seller (Wh)</th><th class="num">Buyer (Wh)</th><th class="num">Gap</th><th>Result</th><th>Tx</th><th>Action</th><th><span class="sr-only">Receipt</span></th></tr></thead><tbody>
    ${oracle.map((t) => {
      const { sellerWh, buyerWh } = readingsOf(t);
      const gap = sellerWh != null && buyerWh != null ? gapPct(sellerWh, buyerWh) : null;
      const expired = t.expiresAt && t.expiresAt * 1000 < Date.now();
      let action = '–';
      if (t.status === 'Disputed') action = isOwner
        ? `<form class="form" data-form="resolve" data-id="${t.id}" style="margin:0"><input name="wh" inputmode="numeric" value="${buyerWh ?? ''}" aria-label="Accepted Wh for trade ${t.id}" style="flex:1 1 70px;padding:7px 8px"><button class="btn btn-dark btn-sm" type="submit">Resolve</button></form>`
        : `<span class="muted" style="font-size:12.5px">owner resolves</span>`;
      else if (t.status === 'Open' && expired) action = `<button class="btn btn-line btn-sm" type="button" data-act="refund" data-id="${t.id}">Refund buyer</button>`;
      return `<tr class="${t.status === 'Disputed' ? 'flag' : ''} rc-link" data-act="receipt" data-id="${t.id}" tabindex="0" title="Open the receipt of trade #${t.id}"><td data-label="Trade" class="mono">#${t.id}</td><td data-label="Opened">${clock(t.openTime)}</td>
        <td data-label="Order (Wh)" class="num">${backendTrade(t.id)?.targetWh ?? '–'}</td>
        <td data-label="Seller (Wh)" class="num">${fmtWh(sellerWh)}</td><td data-label="Buyer (Wh)" class="num">${fmtWh(buyerWh)}</td>
        <td data-label="Gap" class="num" style="color:${gap != null && gap > (T?.toleranceBps ?? 300) / 100 ? 'var(--alert)' : 'inherit'}">${gap == null ? '–' : gap.toFixed(1) + '%'}</td>
        <td data-label="Result"><span class="pill ${resultOf(t)[0]}">${resultOf(t)[1]}</span>${backendTrade(t.id)?.label ? ' <span class="pill sim" title="SIMULATED_TESTNET_SETTLEMENT">sim</span>' : ''}</td>
        <td data-label="Tx">${(t.settleTx || t.openTx) ? `<a class="ext" href="${txUrl(t.settleTx || t.openTx)}" target="_blank" rel="noopener">${shortHash(t.settleTx || t.openTx)}</a>` : '–'}</td>
        <td data-label="Action">${action}</td><td class="rc-go" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></td></tr>`;
    }).join('')}</tbody></table></div>`);

  patch('o-escrow', `<div class="ph"><h2>Escrow contract</h2><span class="pill ${T?.paused ? 'bad' : 'ok'}">${T ? (T.paused ? 'Paused' : 'Active') : '–'}</span></div>
    <div class="rows">
      <div class="row"><span>Address</span><b><a class="ext" href="${addrUrl(CHAIN.escrow)}" target="_blank" rel="noopener">${short(CHAIN.escrow)}</a></b></div>
      <div class="row"><span>Network</span><b>${CHAIN.chainId === 84532 ? 'Base Sepolia' : 'chain ' + CHAIN.chainId}</b></div>
      <div class="row"><span>Held in escrow + unclaimed</span><b>${money(T?.balance)}</b></div>
      <div class="row"><span>Reading tolerance</span><b>${pct(T?.toleranceBps)}</b></div>
      <div class="row"><span>Fee split</span><b>${T ? `utility ${pct(T.utilityBps)} · platform ${pct(T.platformBps)}` : '–'}</b></div>
      <div class="row"><span>Arbiter (owner)</span><b>${T?.owner ? `<a class="ext" href="${addrUrl(T.owner)}" target="_blank" rel="noopener">${short(T.owner)}</a>` : '–'}</b></div>
      <div class="row"><span>Last block seen</span><b>${state.block ? state.block.toLocaleString('en-US') : '–'}</b></div>
    </div>`);

  const accts = [['Seller', ACCOUNTS.seller.address], ['Buyer (refunds)', ACCOUNTS.buyer.address], ['Utility', ACCOUNTS.utility.address], ['Aegis platform', ACCOUNTS.platform.address]];
  if (state.wallet && !accts.some(([, a]) => same(a, state.wallet.address))) accts.push(['Your wallet', state.wallet.address]);
  const ledger = list.flatMap((t) => momoForTrade(t, shareBps()).filter((r) => r.status !== 'PENDING'));
  const tot = (k, st) => ledger.filter((r) => r.kind === k && (!st || r.status === st)).reduce((a, r) => a + (r.amount || 0), 0);
  // receipt drawer (opened from an Oracle row): the trade picked, else the newest one
  const rcTrade = list.find((t) => t.id === ui.receiptId) || list[0];
  patch('o-rc-head', receiptNav(list, rcTrade?.id));
  patch('o-receipt', tradeReceiptHTML(rcTrade, rcTrade ? readingsOf(rcTrade) : {}, { shares: shareBps(), tolPct: (T?.toleranceBps ?? 300) / 100, lossPct: 2, txUrl, clock, backend: rcTrade ? backendTrade(rcTrade.id) : null }));

  patch('o-momo', `<div class="ph"><h2>Mobile money ledger</h2><span class="pill sim">Simulated MoMo</span></div>
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><span>Collected (deposits)</span><b style="font-size:18px">${fiat(tot('deposit'))}</b></div>
      <div class="kpi"><span>Paid to sellers</span><b style="font-size:18px">${fiat(tot('payout'))}</b></div>
      <div class="kpi"><span>Refunded to buyers</span><b style="font-size:18px">${fiat(tot('refund'))}</b></div>
      <div class="kpi"><span>Held in disputes</span><b style="font-size:18px">${fiat(tot('deposit', 'HELD'))}</b></div>
    </div>
    ${ledger.length ? `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Trade</th><th>Type</th><th>Number</th><th class="num">Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
      ${ledger.slice(0, 16).map((r) => `<tr class="${r.status === 'HELD' ? 'flag' : ''}"><td data-label="Time">${clock(r.time)}</td><td data-label="Trade" class="mono">#${r.tradeId}</td><td data-label="Type">${r.label}</td><td data-label="Number" class="mono">${esc(r.phone)}</td><td data-label="Amount" class="num">${fiat(r.amount)}</td><td data-label="Status">${momoPill(r.status)}</td><td data-label="Reference" class="mono">${r.ref}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">No mobile money movements yet.</p>'}
    <p class="note">Cedi amounts follow the on-chain trades at a fixed demo price of ${fiat(MOMO.pricePerKWh)} per kWh (above the grid tariff, below a diesel generator). Production would use the MoMo Collections and Disbursements APIs through a server, with the platform funding the escrow.</p>`);

  patch('o-balances', `<div class="ph"><h2>Balances to withdraw</h2><small>pull payments</small></div>
    <div class="rows">${accts.map(([n, a]) => {
      const v = withdrawableOf(a); const mine = same(a, state.wallet?.address);
      return `<div class="row"><span>${n} <a class="ext" href="${addrUrl(a)}" target="_blank" rel="noopener">${short(a)}</a></span><b>${money(v)}${mine && v > 0n ? ` <button class="btn btn-green btn-sm" type="button" data-act="withdraw" style="margin-left:8px">Withdraw</button>` : ''}</b></div>`;
    }).join('')}</div>
    <p class="note">Each party withdraws its own balance with <span class="mono">withdraw()</span> from its wallet.</p>`);
}

function chartSVG() {
  const h = state.history.slice(-300);
  if (h.length < 2) return '<p class="empty">Waiting for telemetry…</p>';
  const W = 640, H = 220, P = { l: 40, r: 10, t: 10, b: 22 };
  const max = Math.max(200, ...h.map((p) => Math.max(p.pvW, p.exportW, p.importW, p.curtailedW, p.unservedW))) * 1.1;
  const t0 = h[0].t, t1 = h[h.length - 1].t;
  const x = (t) => P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const line = (k) => h.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
  let shade = '', from = null;
  h.forEach((p, i) => { if (p.outage && from === null) from = p.t; if ((!p.outage || i === h.length - 1) && from !== null) { shade += `<rect x="${x(from)}" y="${P.t}" width="${Math.max(2, x(p.t) - x(from))}" height="${H - P.t - P.b}" fill="#FEE2E2"/>`; from = null; } });
  const step = max > 1000 ? 500 : max > 400 ? 200 : 100;
  let grid = '';
  for (let v = 0; v <= max; v += step) grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#E3E9F0"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#5A6B80" font-family="IBM Plex Mono, monospace">${v}</text>`;
  const last = h[h.length - 1];
  const area = (k) => `${line(k)} L${x(last.t).toFixed(1)} ${y(0).toFixed(1)} L${x(h[0].t).toFixed(1)} ${y(0).toFixed(1)}Z`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Live power in watts">
    <defs><linearGradient id="gPv" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F59E0B" stop-opacity=".22"/><stop offset="1" stop-color="#F59E0B" stop-opacity="0"/></linearGradient>
      <linearGradient id="gEx" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#16A34A" stop-opacity=".22"/><stop offset="1" stop-color="#16A34A" stop-opacity="0"/></linearGradient></defs>
    ${shade}${grid}<path d="${area('pvW')}" fill="url(#gPv)"/><path d="${area('exportW')}" fill="url(#gEx)"/>
    <text x="${P.l}" y="${H - 6}" font-size="10" fill="#5A6B80" font-family="IBM Plex Mono, monospace">${simClock(h[0].simMin)}</text>
    <text x="${W - P.r}" y="${H - 6}" text-anchor="end" font-size="10" fill="#5A6B80" font-family="IBM Plex Mono, monospace">${simClock(last.simMin)} sim · W</text>
    <path d="${line('curtailedW')}" fill="none" stroke="#E5484D" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${line('unservedW')}" fill="none" stroke="#E5484D" stroke-width="1.5"/>
    <path d="${line('pvW')}" fill="none" stroke="#F59E0B" stroke-width="2"/>
    <path d="${line('importW')}" fill="none" stroke="#2563EB" stroke-width="2"/>
    <path d="${line('exportW')}" fill="none" stroke="#16A34A" stroke-width="2.4"/>
    <circle cx="${x(last.t)}" cy="${y(last.exportW)}" r="4" fill="#16A34A"/><circle cx="${x(last.t)}" cy="${y(last.importW)}" r="3.5" fill="#2563EB"/></svg>`;
}

// ------------------------------------------------------------------ actions
main.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  if (act === 'receipt' && btn.tagName === 'TR' && e.target.closest('a, form, input, button')) return;
  const s = state.seller, b = state.buyer;
  const sim = (patchObj, msg) => { if (simControl(patchObj)) { if (msg) toast(msg); } else toast('Not connected to MQTT yet.'); };
  switch (act) {
    case 'outage-on': return sim({ outage: true }, 'Load shedding started (mock meters).');
    case 'request-on': return sim({ requesting: true, targetWh: orderWh() }, `Request for ${orderWh()} Wh sent. The bridge opens a trade on-chain.`);
    case 'pay-open': ui.momo = 'confirm'; return render();
    case 'pay-cancel': ui.momo = null; return render();
    case 'pay-send': ui.momo = 'prompt'; return render();
    case 'pay-decline': ui.momo = 'declined'; return render();
    case 'pay-approve':
      ui.momo = 'processing'; render();
      setTimeout(() => {
        ui.momo = null;
        if (simControl({ requesting: true, targetWh: orderWh() })) toast(`MoMo deposit of ${fiat(depositFiat(orderMaxWh()))} received (simulated). Opening the trade for ${orderWh()} Wh…`);
        else toast('Payment confirmed, but MQTT is offline: the request could not be sent.');
        render();
      }, 1600);
      return undefined;
    case 'request-off': return sim({ requesting: false }, 'Stopping. Both meters will sign their final readings.');
    case 't-outage': return sim({ outage: state.grid !== 'OUTAGE' });
    case 't-day': return sim({ pvW: s && Number(s.pvW) > 0 ? 0 : 800 });
    case 't-request': return sim(b?.requesting ? { requesting: false } : { requesting: true, targetWh: orderWh() });
    case 'wh-minus': case 'wh-plus': case 'wh-set': {
      const { step } = orderSteps(orderRate());
      ui.targetWh = clampOrder(act === 'wh-set' ? Number(btn.dataset.wh) : orderWh() + (act === 'wh-plus' ? step : -step), maxOrderWh(), orderRate());
      localSet('aegis.order', String(ui.targetWh));
      return render();
    }
    case 't-tamper': return sim({ tamper: !b?.tamper }, !b?.tamper ? 'Buyer meter will under-report by 40%.' : 'Buyer meter honest again.');
    case 't-backup': return sim({ backup: !s?.backupAllowed }, !s?.backupAllowed ? 'Emergency backup on: community loads may use the battery.' : 'Emergency backup off: the battery serves the shop only.');
    case 'engine-mock': chooseEngine('mock'); syncEngineSwitch(document.querySelectorAll('[data-engine]')); return sim({ engine: 'mock' }, 'Source: mock. The Wokwi-compatible mock publishes again.');
    case 'engine-wokwi': chooseEngine('wokwi'); syncEngineSwitch(document.querySelectorAll('[data-engine]')); return sim({ engine: 'wokwi' }, 'Mock paused. Waiting for telemetry from the real Wokwi…');
    case 'go-control': return go('o-grid');
    case 'receipt': ui.receiptId = Number(btn.dataset.id); render(); return receipts.open();
    case 'load-up': return sim({ shopLoadW: Math.min(600, Number(b?.loadW ?? 300) + 50) });
    case 'load-down': return sim({ shopLoadW: Math.max(0, Number(b?.loadW ?? 300) - 50) });
    case 'as-ama': ui.persona = 'ama'; ui.mode = 'buyer'; save(); return render();
    case 'mode-seller': ui.mode = 'seller'; save(); return render();
    case 'connect': return connect();
    case 'withdraw': return walletAction('withdraw', () => tx.withdraw(), 'Withdrawn to your wallet.');
    case 'refund': return walletAction('refund', () => tx.refundExpired(btn.dataset.id), `Trade #${btn.dataset.id} refunded to the buyer.`);
    default: return undefined;
  }
});

// Oracle rows open the receipt drawer: also with Enter / Space for keyboard users.
main.addEventListener('keydown', (e) => {
  const tr = e.target.closest?.('tr.rc-link');
  if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
});

// Control room sliders: show the value while dragging, send it when released.
main.addEventListener('input', (e) => {
  const r = e.target.closest('input[type="range"][data-ctl]');
  if (!r) return;
  const out = document.getElementById(`${r.id}-out`);
  if (out) out.textContent = `${r.value} W`;
  r.setAttribute('aria-valuetext', `${r.value} watts`);
});
main.addEventListener('change', (e) => {
  const r = e.target.closest('input[type="range"][data-ctl]');
  if (!r) return;
  const ok = simControl({ [r.dataset.ctl]: Number(r.value) });
  toast(ok ? `${r.dataset.ctl === 'pvW' ? 'PV production' : 'Community load'} set to ${r.value} W.` : 'Not connected to MQTT yet.');
  r.blur(); // let live telemetry refresh the slider again
});

main.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  if (f.dataset.form === 'register') {
    const addr = f.meter.value.trim();
    if (!isAddress(addr)) return toast('Enter a valid 0x address for the meter signing key.');
    walletAction('register', () => tx.registerMeter(addr), 'Meter registered on-chain.');
  } else if (f.dataset.form === 'resolve') {
    const v = f.wh.value.trim();
    if (!/^\d+$/.test(v)) return toast('Enter the accepted energy as a whole number of Wh (0 refunds the buyer).');
    walletAction('resolve', () => tx.resolveDispute(f.dataset.id, v), `Trade #${f.dataset.id} resolved.`);
  }
});

async function walletAction(name, fn, okMsg) {
  ui.busy = name; parts.clear(); render();
  try {
    const hash = await fn();
    toast(okMsg);
    console.info(name, txUrl(hash));
  } catch (err) {
    toast(err.message);
  } finally {
    ui.busy = null; parts.clear(); render();
  }
}

tabbar.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-go]');
  if (!a) return;
  e.preventDefault();
  go(a.dataset.go);
});

// ------------------------------------------------------------------ account menu
const acctBtn = $('acctBtn'), acctMenu = $('acctMenu');
function renderAccount() {
  $('acctAv').textContent = initials(session.name);
  $('acctName').textContent = session.name.split(' ')[0];
  const s = session;
  const head = `<div class="am-head"><span class="acct-av big">${esc(initials(s.name))}</span><div><b>${esc(s.name)}</b><small>${esc(METHOD_LABEL[s.method] || '')}${s.phone ? ` · ${esc(maskPhone(s.phone))}` : ''}</small></div></div>`;
  let wallet = '';
  if (s.method === 'wallet') {
    const on = state.wallet && same(state.wallet.address, s.address);
    wallet = `<div class="am-wallet"><span>Signed in with ${esc(s.walletName || 'a browser wallet')}</span><b class="mono">${esc(short(s.address))}</b><small>${on ? 'Connected' : 'Not connected right now: use Connect wallet'}</small></div>`;
  } else if (s.address) {
    wallet = `<div class="am-wallet"><span>Your Aegis wallet</span><b class="mono">${esc(short(s.address))}</b>
      <small>${s.method === 'momo' ? 'Linked to your MoMo number (simulated)' : 'Locked with your password, stored in this browser (prototype)'}</small>
      <div class="am-links"><button type="button" data-am="copy">Copy address</button><a href="${addrUrl(s.address)}" target="_blank" rel="noopener">View on explorer</a></div></div>`;
  }
  const area = s.area ? `<div class="am-row"><span>Neighbourhood</span><b>${esc(s.area)}</b></div>` : '';
  const note = `<p class="am-note">You are looking at the demo street: the buyer's shop (meter B) and the seller's battery (meter A). Switch between Buyer, Seller and Operator in the top bar.</p>
    <button type="button" class="am-item" data-am="onboard" role="menuitem">Register a new battery (onboarding)</button>`;
  const items = s.method === 'guest'
    ? `<a class="am-item" href="./auth.html#signup" role="menuitem">Create an account</a><a class="am-item" href="./auth.html#login" role="menuitem">Log in</a>`
    : `<a class="am-item" href="./auth.html#role" role="menuitem">Change what I need</a><button type="button" class="am-item danger" data-am="logout" role="menuitem">Log out</button>`;
  acctMenu.innerHTML = head + wallet + area + note + items;
}
function toggleMenu(open = acctMenu.hidden) {
  if (open) renderAccount();
  acctMenu.hidden = !open;
  acctBtn.setAttribute('aria-expanded', String(open));
}
acctBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
acctMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-am]');
  if (!b) return;
  if (b.dataset.am === 'copy') navigator.clipboard?.writeText(session.address).then(() => toast('Wallet address copied.'), () => {});
  if (b.dataset.am === 'logout') { clearSession(); disconnectWallet(); location.href = './auth.html#login'; }
  if (b.dataset.am === 'onboard') { toggleMenu(false); ui.persona = 'ama'; ui.mode = 'seller'; save(); render(); }
});
document.addEventListener('click', (e) => { if (!acctMenu.hidden && !acctMenu.contains(e.target)) toggleMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !acctMenu.hidden) { toggleMenu(false); acctBtn.focus(); } });
renderAccount();

async function connect() {
  if (ui.busy) return;
  ui.busy = 'connect'; parts.clear(); render();
  try {
    await connectWallet();
    toast('Wallet connected (Base Sepolia).');
  } catch (err) {
    toast(explain(err));
  } finally {
    ui.busy = null; parts.clear(); render();
  }
}
$('walletBtn').addEventListener('click', connect);
$('persona').addEventListener('change', (e) => {
  ui.persona = e.target.value;
  if (ui.persona !== 'ops') ui.mode = PERSONAS[ui.persona].role;
  save(); render();
});
// connection status popover
const liveBtn = $('liveBtn'), livePop = $('livePop');
function toggleLive(open = livePop.hidden) {
  livePop.hidden = !open;
  liveBtn.setAttribute('aria-expanded', String(open));
  if (open) { const r = liveBtn.getBoundingClientRect(); livePop.style.top = `${r.bottom + 10}px`; livePop.style.left = `${Math.max(12, Math.min(innerWidth - 292, r.left + r.width / 2 - 140))}px`; }
}
liveBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLive(); });
document.addEventListener('click', (e) => { if (!livePop.hidden && !livePop.contains(e.target)) toggleLive(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !livePop.hidden) { toggleLive(false); liveBtn.focus(); } });
addEventListener('resize', () => { if (!livePop.hidden) toggleLive(true); });
function save() { localSet('aegis.persona', ui.persona); localSet('aegis.mode', ui.mode); }

subscribe(render);
setInterval(() => update(), 2000); // refresh "meter online" chips even when nothing arrives
render();
