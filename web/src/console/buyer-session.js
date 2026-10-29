// Buyer (UMKM B) request flow: order size (Stage 6), MoMo checkout, live session, closing and receipt.
// Pure render functions: main.js passes the data in, so the dashboard and the design preview use the
// same markup. Order-size rules: lib/sizing.js (shared with the backend, checked by a test).
import { orderSteps, DEFAULT_RATE } from '../lib/sizing.js';

const SHOP_W = 500; // a small shop: lights, a fan, a fridge and phone charging, to make an order size concrete

/**
 * "= 2 kWh at a real shop: a 500 W shop runs 4 h · the demo delivers 20 Wh in about 2.4 min"
 * scale: demo energy scale (MOMO.demoScale), 1 measured Wh = scale Wh at a real shop.
 */
function orderHint(wh, rate, scale) {
  const realWh = wh * scale;
  const h = realWh / SHOP_W;
  const use = h >= 1 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h * 60)} min`;
  const s = (wh / (rate.powerW * rate.energyScale)) * 3600; // real seconds of supply at the trade power
  const dur = s < 90 ? `${Math.round(s)} s` : `${Math.round((s / 60) * 10) / 10} min`;
  const kwh = Math.round((realWh / 1000) * 100) / 100;
  return `= ${kwh} kWh at a real shop (demo scale ×${scale}): a ${SHOP_W} W shop runs ${use} · the demo delivers ${wh} Wh in about ${dur}`;
}

/** Order stepper: − / + by 10 Wh, presets, and what the order means in practice. */
export function orderPickerHTML({ targetWh, maxOrderWh, rate = DEFAULT_RATE, scale = 1, disabled = false }) {
  const { step, min, presets } = orderSteps(rate);
  const dis = (cond) => (disabled || cond ? 'disabled' : '');
  return `<div class="order" role="group" aria-labelledby="order-l">
    <div class="order-top">
      <span class="order-l" id="order-l">How much power?</span>
      <div class="order-step">
        <button type="button" data-act="wh-minus" aria-label="${step} Wh less" ${dis(targetWh <= min)}>−</button>
        <output class="mono" aria-live="polite"><b>${targetWh}</b> Wh</output>
        <button type="button" data-act="wh-plus" aria-label="${step} Wh more" ${dis(targetWh >= maxOrderWh)}>+</button>
      </div>
    </div>
    <div class="order-presets">${presets.filter((p) => p <= maxOrderWh).map((p) => `<button type="button" data-act="wh-set" data-wh="${p}" aria-pressed="${p === targetWh}" ${dis(false)}>${p} Wh</button>`).join('')}</div>
    <small class="order-hint">${orderHint(targetWh, { ...DEFAULT_RATE, ...rate }, scale)}</small>
  </div>`;
}

/** Idle card: choose the order, see the deposit, request. */
export function requestCardHTML({ outage, canRequest, targetWh, maxOrderWh, rate, scale, realText, maxWh, depositText, rateText, priceText, generatorText }) {
  return `<div class="req-card"><div class="ph"><h2>Request clean power</h2></div>
    <p style="margin:0;color:var(--muted)">${outage
      ? 'Buy energy from a seller\'s battery on your street. Choose how much you need. You pay a small deposit with mobile money, and you are charged only for the energy your meter receives. The rest comes back to your MoMo.'
      : 'Available during load shedding.'}</p>
    ${orderPickerHTML({ targetWh, maxOrderWh, rate, scale, disabled: !outage })}
    <div class="momo-quote"><span>Deposit for ${targetWh} Wh</span><b>${depositText}</b><small>You pay about ${priceText} for ${realText} (${targetWh} Wh in the demo) at ${rateText}/kWh; a diesel generator: about ${generatorText}. The unused deposit comes back to your MoMo. Escrow ${maxWh} Wh, incl. cable loss and stop margin.</small></div>
    <button class="btn btn-momo btn-big" type="button" data-act="pay-open" ${canRequest ? '' : 'disabled'}><span class="momo-dot" aria-hidden="true">M</span>Request ${targetWh} Wh · pay with MoMo</button>
    <p class="note"><span class="pill sim">Simulated MoMo</span> No real payment is made. After the deposit, the backend opens the trade on-chain for your order and starts the supply in the Wokwi simulation.</p></div>`;
}

export function openingCardHTML({ targetWh }) {
  return `<div class="req-card"><div class="ph"><h2>Request clean power</h2><span class="pill warn">Opening trade</span></div>
    <div class="searching"><span class="spinner" aria-hidden="true"></span>The bridge is opening a trade on-chain${targetWh ? ` for ${targetWh} Wh` : ''} and depositing the escrow. This takes one block.</div>
    <button class="btn btn-line" type="button" data-act="request-off">Cancel request</button></div>`;
}

/**
 * Live session with the order progress.
 * receivedWh: live energy received (meter count, or estimate from METER_A's counter when estimate=true).
 * stopAtWh: the shop pressed Stop; the backend ends the supply at this whole Wh.
 */
export function liveSessionHTML(x) {
  const pct = x.targetWh ? Math.min(100, (x.receivedWh / x.targetWh) * 100) : null;
  const recv = `${x.receivedWh.toFixed(1)}${x.targetWh ? ` / ${x.targetWh}` : ''} Wh`;
  return `<div class="live"><div class="ph"><h2>Live session · trade #${x.tradeId}</h2><span class="pill ${x.statusTone}">${x.statusText}</span></div>
    <div class="live-num"><b class="mono">${Math.round(x.importW)}</b><span>W from the seller's battery${x.batteryText ? ` · battery ${x.batteryText}` : ''}</span></div>
    ${pct != null ? `<div class="order-prog" role="progressbar" aria-label="Order received" aria-valuemin="0" aria-valuemax="${x.targetWh}" aria-valuenow="${x.receivedWh.toFixed(1)}">
      <div class="order-prog-h"><span>Received</span><b class="mono">${recv}</b></div>
      <div class="order-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <small>${x.estimate ? 'Live estimate from the seller meter (minus 2% cable loss). Your meter\'s final reading decides the bill.' : 'Counted by your meter.'} Stops automatically at ${x.targetWh} Wh, or press Stop.</small>
    </div>` : '<div class="flowbar" aria-hidden="true"><i></i></div>'}
    <div class="rows">
      ${pct == null ? `<div class="row"><span>Energy received${x.estimate ? ' (estimate)' : ' (your meter)'}</span><b>${recv}</b></div>` : ''}
      <div class="row"><span>Cost so far${x.estimate ? ' (est.)' : ''}</span><b>${x.costText}</b></div>
      <div class="row"><span>Deposit paid with MoMo</span><b>${x.depositText} <span class="pill sim">sim</span></b></div>
      <div class="row"><span>Escrowed on-chain</span><b>${x.escrowText}</b></div>
      <div class="row"><span>Still unserved</span><b>${x.unservedText}</b></div>
      <div class="row"><span>Opened</span><b>${x.openTxHtml}</b></div>
    </div>
    ${x.stopAtWh ? `<button class="btn btn-line" type="button" disabled>Stopping at ${x.stopAtWh} Wh…</button>
    <p class="note">The supply runs a few more seconds to a whole Wh, so both meter readings pass the check. You pay only for what you receive.</p>`
    : '<button class="btn btn-line" type="button" data-act="request-off">Stop and pay</button>'}</div>`;
}

/** After STOP (button or order reached): both final readings, then the backend's check. */
export function closingCardHTML({ tradeId, sellerWh, buyerWh, testnet, orderReached, targetWh, fmtWh }) {
  return `<div class="req-card"><div class="ph"><h2>Closing trade #${tradeId}</h2><span class="pill blue">Verifying</span></div>
    ${orderReached ? `<p style="margin:0 0 10px;color:var(--muted)">Your order of ${targetWh} Wh was reached, so the supply stopped automatically.</p>` : ''}
    <ul class="timeline">
      <li class="${sellerWh != null ? 'done' : 'now'}">Seller meter final reading: ${sellerWh != null ? `${fmtWh(sellerWh)} Wh` : '…'}</li>
      <li class="${buyerWh != null ? 'done' : 'now'}">Your meter final reading: ${buyerWh != null ? `${fmtWh(buyerWh)} Wh` : '…'}</li>
      <li class="${buyerWh != null ? 'now' : ''}">${testnet ? 'The backend checks both readings, each gateway signs its own (EIP-712), then settleTrade on testnet' : 'The backend checks both readings (3% tolerance); settlement is off for simulated readings'}</li>
    </ul></div>`;
}

/** Simulated MoMo checkout for the chosen order. step: confirm | prompt | processing | declined */
export function momoCheckoutHTML({ step, amountText, targetWh, maxWh, phone, esc }) {
  if (step === 'confirm') {
    return `<div class="req-card"><div class="ph"><h2>Pay deposit with MoMo</h2><span class="pill sim">Simulated</span></div>
      <div class="rows">
        <div class="row"><span>MoMo number</span><b>${esc(phone)}</b></div>
        <div class="row"><span>Your order</span><b>${targetWh} Wh</b></div>
        <div class="row"><span>Deposit (escrow ${maxWh} Wh, incl. cable loss and stop margin)</span><b>${amountText}</b></div>
        <div class="row"><span>You pay for</span><b>energy your meter receives</b></div>
        <div class="row"><span>Unused deposit</span><b>refunded to your MoMo</b></div>
      </div>
      <button class="btn btn-momo btn-big" type="button" data-act="pay-send"><span class="momo-dot" aria-hidden="true">M</span>Send payment request</button>
      <button class="btn btn-line" type="button" data-act="pay-cancel">Cancel</button></div>`;
  }
  if (step === 'prompt') {
    return `<div class="req-card"><div class="ph"><h2>Approve on your phone</h2><span class="pill warn">Waiting for you</span></div>
      <div class="phone" role="group" aria-label="Simulated MoMo approval on the buyer's phone">
        <div class="phone-bar"><span class="momo-dot" aria-hidden="true">M</span>MoMo · payment request</div>
        <p><b>Aegis-Grid</b> requests <b>${amountText}</b> as a deposit for ${targetWh} Wh of clean power from your neighbour's battery.</p>
        <p class="muted" style="font-size:12.5px">You pay only for the energy you receive. The rest is refunded to this number.</p>
        <div class="pin" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="phone-actions"><button class="btn btn-line" type="button" data-act="pay-decline">Decline</button><button class="btn btn-momo" type="button" data-act="pay-approve">Approve</button></div>
      </div>
      <p class="note">This screen stands in for the PIN prompt that MoMo sends to the buyer's phone.</p></div>`;
  }
  if (step === 'processing') {
    return `<div class="req-card"><div class="ph"><h2>Confirming payment</h2><span class="pill warn">Pending</span></div>
      <ul class="timeline"><li class="done">Payment request sent to ${esc(phone)}</li><li class="done">Approved on the phone</li><li class="now">Waiting for MoMo to confirm ${amountText}</li><li>Bridge opens the trade on-chain for ${targetWh} Wh</li></ul></div>`;
  }
  return `<div class="req-card"><div class="ph"><h2>Payment declined</h2><span class="pill bad">Declined</span></div>
    <p style="margin:0;color:var(--muted)">No money was taken and no trade was opened.</p>
    <button class="btn btn-momo btn-big" type="button" data-act="pay-open"><span class="momo-dot" aria-hidden="true">M</span>Try again</button>
    <button class="btn btn-line" type="button" data-act="pay-cancel">Close</button></div>`;
}

/**
 * Buyer receipt (last trade). x: { pill:[cls,label], simLabelHtml, sellerWh, buyerWh, signedTxt, gap, tol, tamper,
 *   targetWh, settledRowHtml, savedHtml, outcomeHtml, momoHtml, chainHtml, fmtWh }
 */
export function buyerReceiptHTML(id, x) {
  return `<div class="ph"><h2>Trade #${id}</h2><span style="display:flex;gap:6px;flex-wrap:wrap">${x.simLabelHtml}<span class="pill ${x.pill[0]}">${x.pill[1]}</span></span></div>
  <div class="receipt">
    <div class="meters">
      <div><span>Meter A · seller sent</span><b>${x.fmtWh(x.sellerWh)}</b> <em>${x.signedTxt}</em></div><span aria-hidden="true">⇄</span>
      <div><span>Meter B · shop received</span><b>${x.fmtWh(x.buyerWh)}</b> <em>${x.signedTxt}</em></div>
    </div>
    <div class="rows">
      ${x.targetWh ? `<div class="row"><span>Your order</span><b>${x.targetWh} Wh</b></div>` : ''}
      <div class="row"><span>Difference</span><b style="color:${x.gap == null ? 'inherit' : x.gap <= x.tol ? 'var(--green)' : 'var(--alert)'}">${x.gap == null ? '–' : `${x.gap.toFixed(1)}% · ${x.gap <= x.tol ? 'within' : 'over'} ${x.tol}%`}</b></div>
      ${x.settledRowHtml}
      ${x.savedHtml || ''}
      ${x.tamper ? '<div class="row"><span>Buyer meter</span><b style="color:var(--alert)">tamper switch on</b></div>' : ''}
    </div>
    ${x.outcomeHtml}
    ${x.momoHtml}
    ${x.chainHtml}
  </div>`;
}
