// Dual-meter receipt for one trade, opened from a row of the operator Oracle table.
// It joins the two signed meter readings (what Meter A sent, what Meter B received), the contract's
// verdict and the simulated MoMo money movements (same numbers as the ledger, from momoForTrade).
import { momoForTrade, fiat, whToFiat, depositFiat, realText } from '../lib/momo.js';
import { MOMO } from '../lib/config.js';
import { esc } from '../lib/format.js';

const STATUS = {
  Settled: ['ok', 'Settled · paid'],
  Disputed: ['bad', 'Disputed · frozen'],
  Open: ['warn', 'Open'],
  Refunded: ['idle', 'Refunded'],
};
const cash = fiat;
// whole Wh as on-chain; firmware finals (Stage 5B) keep two decimals
const whTxt = (v) => (v == null ? '–' : Number.isInteger(Number(v)) ? Number(v).toLocaleString('en-US') : Number(v).toFixed(2));

const ICO = {
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  out: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
};
const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/**
 * "View on blockchain" button: opens the trade's latest transaction (settlement, refund, else the deposit) on the
 * block explorer. x: { openTx, settleTx, refundTx, txUrl(hash) }
 */
export function chainButtonHTML(x) {
  const [hash, what] = x.settleTx ? [x.settleTx, 'settlement'] : x.refundTx ? [x.refundTx, 'refund'] : [x.openTx, 'deposit'];
  if (!hash) return '';
  return `<a class="btn btn-line btn-sm chain-btn" href="${x.txUrl(hash)}" target="_blank" rel="noopener" title="Open the ${what} transaction on the Base Sepolia block explorer">${ico(ICO.cube)}View on blockchain${ico(ICO.out)}</a>`;
}

/** Drawer header: which trade, and newer / older buttons (the Oracle table is the full list). */
export function receiptNav(list, selectedId) {
  const i = list.findIndex((t) => t.id === selectedId);
  if (i < 0) return '<h2 id="rc-d-title">Trade receipt</h2>';
  const btn = (t, label, d) => `<button class="rc-d-nav" type="button" ${t ? `data-act="receipt" data-id="${t.id}"` : 'disabled'} aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></button>`;
  return `<h2 id="rc-d-title">Trade receipt</h2>
    <div class="rc-d-pager">${btn(list[i + 1], 'Older trade', 'M15 6l-6 6 6 6')}<span class="mono">${list.length - i} / ${list.length}</span>${btn(list[i - 1], 'Newer trade', 'M9 6l6 6-6 6')}</div>`;
}

/**
 * Side drawer that holds the receipts. It lives on <body> (not inside an animated view) so it can be fixed
 * to the screen edge. Contents are the parts "o-rc-head" and "o-receipt", filled by the page's patch().
 * onPick(id) is called when a trade is chosen inside the drawer.
 */
export function mountReceiptDrawer(onPick) {
  const scrim = document.createElement('div');
  scrim.className = 'rc-scrim';
  const d = document.createElement('aside');
  d.className = 'rc-drawer';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-labelledby', 'rc-d-title');
  d.inert = true;
  d.innerHTML = `<header class="rc-d-h"><div class="rc-d-t" data-part="o-rc-head"><h2 id="rc-d-title">Trade receipt</h2></div>
      <button class="rc-d-x" type="button" aria-label="Close receipts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <div class="rc-d-body" data-part="o-receipt"></div>`;
  document.body.append(scrim, d);
  let back = null;
  const close = () => {
    if (!d.classList.contains('on')) return;
    d.classList.remove('on'); scrim.classList.remove('on'); d.inert = true;
    document.documentElement.classList.remove('rc-lock');
    back?.focus?.();
  };
  const open = () => {
    if (d.classList.contains('on')) return;
    back = document.activeElement;
    d.inert = false; d.classList.add('on'); scrim.classList.add('on');
    document.documentElement.classList.add('rc-lock');
    d.querySelector('.rc-d-x').focus();
  };
  scrim.addEventListener('click', close);
  d.querySelector('.rc-d-x').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="receipt"]');
    if (b) { onPick(Number(b.dataset.id)); d.querySelector('.rc-d-body').scrollTo({ top: 0 }); }
  });
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const nav = d.querySelectorAll('.rc-d-nav')[e.key === 'ArrowLeft' ? 0 : 1];
    if (nav && !nav.disabled) nav.click();
  });
  return { open, close, isOpen: () => d.classList.contains('on') };
}

/**
 * @param t        trade record (chain events: status, maxWh, deliveredWh, sellerWh/buyerWh on a dispute, times, txs)
 * @param r        final readings { sellerWh, buyerWh, socAfter } (signed by the meters)
 * @param o        { shares: {util, plat} bps, tolPct, lossPct, txUrl(hash), clock(sec), note }
 */
export function receiptHTML(t, r, o) {
  if (!t) return '<p class="empty">No trade yet. A receipt appears here as soon as a buyer request opens a trade.</p>';
  const bt = o.backend || null; // Stage 5B.3 backend record (verdict, label, fractional finals)
  const BT = { SIMULATION_VERIFIED: ['ok', 'Simulation verified'], REJECTED: ['bad', 'Rejected · not settled'], FAILED: ['bad', 'Failed · not settled'], SIGNING: ['blue', 'Signing'], AWAITING_EVIDENCE: ['warn', 'Awaiting evidence'] };
  const [tone, label] = t.status === 'Settled' && t.disputed ? ['warn', 'Resolved by arbiter'] : t.status === 'Open' && BT[bt?.status] ? BT[bt.status] : STATUS[t.status] || ['idle', t.status];
  const sent = r.sellerWh, got = r.buyerWh;
  const gap = sent ? ((sent - got) / sent) * 100 : null;
  const within = gap != null && Math.abs(gap) <= o.tolPct;
  const lostWh = sent != null && got != null ? sent - got : null;

  // verdict line
  let verdict;
  if (t.status === 'Open' && bt?.status === 'SIMULATION_VERIFIED') verdict = ['ok', `Simulation verified: gap ${gap == null ? '?' : gap.toFixed(2)}% (limit ${o.tolPct}%)`, 'Both Wokwi final readings are consistent. SETTLEMENT_MODE=off: simulated readings are not settled on-chain, so the deposit returns to the buyer when the trade expires.'];
  else if (t.status === 'Open' && (bt?.status === 'REJECTED' || bt?.status === 'FAILED')) verdict = ['bad', 'Rejected by the backend: nothing sent on-chain', `${bt.reason || 'The evidence failed a check'}. The deposit returns to the buyer when the trade expires.`];
  else if (t.status === 'Open') verdict = ['warn', 'Trade open', o.note || 'The meters are counting. The receipt is final once the backend has checked both final readings.'];
  else if (t.status === 'Refunded') verdict = ['idle', 'Refunded', 'No energy was billed. The full deposit went back to the buyer.'];
  else if (t.status === 'Disputed') verdict = ['bad', `Readings disagree by ${gap == null ? '?' : gap.toFixed(1)}% (limit ${o.tolPct}%)`, 'The contract froze the deposit. Nobody is paid until the arbiter resolves it, or it is refunded after 7 days.'];
  else if (t.disputed) verdict = ['warn', 'Resolved by the arbiter', `The arbiter accepted ${whTxt(t.deliveredWh)} Wh after a dispute.`];
  else verdict = ['ok', 'Readings consistent: settled on-chain', `Both signatures checked by the contract. The buyer pays only for the ${whTxt(t.deliveredWh ?? got)} Wh Meter B received.`];

  // money (the same records the ledger shows)
  const offDone = t.status === 'Open' && ['SIMULATION_VERIFIED', 'REJECTED', 'FAILED'].includes(bt?.status);
  const recs = momoForTrade(t, o.shares);
  const amt = (k) => recs.find((x) => x.kind === k)?.amount;
  const paidWh = t.status === 'Settled' ? t.deliveredWh : null;
  const paid = paidWh != null ? whToFiat(paidWh) : null;
  const sp = 10000 - o.shares.util - o.shares.plat;
  const money = [
    ['Deposit from buyer', `${fiat(depositFiat(t.maxWh))}`, t.status === 'Disputed' ? 'held in escrow' : `up to ${whTxt(t.maxWh || MOMO.tradeMaxWh)} Wh = ${realText(t.maxWh || MOMO.tradeMaxWh)} (×${MOMO.demoScale})`, ''],
    ['Energy billed', paid != null ? cash(paid) : '–', paidWh != null ? `${whTxt(paidWh)} Wh = ${realText(paidWh)} × ${fiat(MOMO.pricePerKWh)}/kWh` : t.status === 'Disputed' ? 'frozen' : offDone ? 'not settled' : 'not yet', ''],
    ['Seller receives', paid != null ? cash(paid * sp / 10000) : '–', `${sp / 100}% · ${esc(MOMO.sellerPhone)}`, 'em'],
    ['Utility grid fee', paid != null ? cash(paid * o.shares.util / 10000) : '–', `${o.shares.util / 100}%`, ''],
    ['Aegis platform fee', paid != null ? cash(paid * o.shares.plat / 10000) : '–', `${o.shares.plat / 100}%`, ''],
    ['Refund to buyer', amt('refund') != null ? cash(amt('refund')) : '–', t.status === 'Settled' || t.status === 'Refunded' ? esc(MOMO.buyerPhone) : t.status === 'Disputed' ? 'held in escrow' : offDone ? 'full deposit, after the trade expires' : 'after settlement', 'em'],
  ];
  const when = t.settleTime || t.refundTime || t.openTime;

  return `<article class="rc" aria-label="Receipt for trade ${t.id}">
    <header class="rc-h">
      <div><h3>Trade #${t.id}<span>Dual-meter receipt</span></h3><small class="mono">${when ? o.clock(when) : ''}</small></div>
      <span class="rc-pills">${bt?.label ? `<span class="pill sim" title="Settled on Base Sepolia testnet with gateway-signed readings from the Wokwi simulation. METER_B is derived from METER_A.">${esc(bt.label)}</span>` : ''}<span class="pill ${tone}">${label}</span></span>
    </header>
    <div class="rc-body">
      <div class="rc-energy">
        <div class="rc-meters">
          <div class="rc-m"><span>METER_A · Seller</span><b class="mono">${whTxt(sent)}<small> Wh</small></b><em>Energy sent · Resident A</em></div>
          <div class="rc-arrow" aria-hidden="true"><svg viewBox="0 0 48 12"><path d="M0 6h44M38 1l6 5-6 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><small class="mono">${lostWh == null ? '' : lostWh > 0 ? `−${whTxt(lostWh)} Wh` : '0 Wh'}</small></div>
          <div class="rc-m"><span>METER_B · Buyer</span><b class="mono">${whTxt(got)}<small> Wh</small></b><em>Energy received · UMKM B</em></div>
        </div>
        <div class="rc-rows">
          <div><span>Difference</span><b class="mono ${gap == null ? '' : within ? 'pos' : 'neg'}">${gap == null ? '–' : `${gap.toFixed(1)}%`}</b></div>
          <div><span>Verification tolerance</span><b class="mono">${o.tolPct}%</b></div>
          ${bt?.targetWh ? `<div><span>Buyer's order</span><b class="mono">${bt.targetWh} Wh</b></div><div><span>Escrow</span><b class="mono">${t.maxWh ?? bt.maxWh} Wh</b></div>` : ''}
          <div><span>Simulated line loss</span><b class="mono">${o.lossPct}%</b></div>
          <div><span>Battery after trade</span><b class="mono">${r.socAfter == null ? '–' : `${(r.socAfter / 100).toFixed(1)}%`}</b></div>
        </div>
        <div class="rc-verdict ${verdict[0]}"><b>${verdict[1]}</b><p>${verdict[2]}</p></div>
      </div>
      <div class="rc-money">
        <div class="rc-mh"><span class="momo-dot" aria-hidden="true">M</span><b>Money</b><span class="pill sim">Simulated MoMo</span></div>
        ${money.map(([k, v, sub, cls]) => `<div class="rc-mr ${cls}"><span>${k}<small>${sub}</small></span><b class="mono">${v}</b></div>`).join('')}
        ${chainButtonHTML({ openTx: t.openTx, settleTx: t.settleTx, refundTx: t.refundTx, txUrl: o.txUrl })}
      </div>
    </div>
  </article>`;
}
