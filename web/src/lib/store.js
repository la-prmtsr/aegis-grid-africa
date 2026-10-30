// One shared state for the whole app, fed by MQTT (live meters) and the chain (escrow events).
// UI code reads `state` and re-renders when `subscribe` fires.

export const state = {
  // MQTT
  mqtt: 'connecting', // connecting | online | offline
  grid: null, // 'OUTAGE' | 'AVAILABLE' | null (unknown)
  seller: null, // last METER_A telemetry
  buyer: null, // last METER_B telemetry
  lastSeen: { METER_A: 0, METER_B: 0 }, // Date.now() of last telemetry
  readings: {}, // tradeId -> { seller: {...}, buyer: {...} } final readings (retained topics)
  backend: null, // relayer status: active trade, approvals, last result, notice
  cases: {}, // trade id -> { status: 'flagged' | 'suspended', at } operator decisions on a suspicious trade
  notices: {}, // user key -> { warnings: [...] } operator warnings (app/notice/<user key>, retained)
  history: [], // rolling telemetry samples for charts: { t, pvW, exportW, curtailedW, importW, unservedW }
  curtailedWhSession: 0, // integrated curtailed energy since this page opened (simulated minutes)

  // chain
  chain: 'connecting', // connecting | online | offline
  chainError: null,
  block: 0,
  totals: null, // { totalDeliveredWh, nextTradeId, toleranceBps, utilityBps, platformBps, owner, paused, balance }
  trades: {}, // id -> trade record built from events + trades(id)
  withdrawable: {}, // address(lowercase) -> bigint
  meters: {}, // address(lowercase) -> registered meter address
  historyLoaded: false,

  // wallet
  wallet: null, // { address, chainOk }
};

const listeners = new Set();
let queued = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Merge a patch and notify listeners once per animation frame. */
export function update(patch = {}) {
  Object.assign(state, patch);
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    listeners.forEach((fn) => fn(state));
  });
}

export const tradeList = () => Object.values(state.trades).sort((a, b) => b.id - a.id);
