// Simulated mobile money (MoMo) layer on top of the real escrow trades.
// Nothing here calls a payment API. Every record is derived from on-chain trade data, so all viewers
// see the same ledger and the dollar amounts always match what the contract settled.
//
// Intended production flow (roadmap, see web/README.md):
//   buyer pays deposit via MoMo Collections (requestToPay) -> platform funds openTrade from its float
//   -> TradeSettled -> MoMo Disbursements (transfer) to the seller, refund of unused deposit to the buyer.
import { MOMO } from './config.js';

// US dollars in cents. With the demo scale (×100) a trade is worth $0.30 to $3; a live estimate in its first seconds
// can be below a cent and shows as <$0.01.
export function fiat(v) {
  if (v == null) return '–';
  const n = Number(v);
  if (n > 0 && n < 0.005) return `&lt;${MOMO.currency}0.01`;
  return `${MOMO.currency}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Real-world kWh that a measured (demo) Wh amount represents: demo scale ×100 by default (config.js). */
export const realKWh = (wh) => (Number(wh || 0) * MOMO.demoScale) / 1000;
/** "2 kWh" / "0.46 kWh" */
export const realText = (wh) => { const k = realKWh(wh); return `${k.toLocaleString('en-US', { maximumFractionDigits: k < 10 ? 2 : 1 })} kWh`; };
/** Price of a measured Wh amount, on the real-world energy it represents. */
export const whToFiat = (wh) => realKWh(wh) * MOMO.pricePerKWh;
/** What a small diesel generator would have cost for the same real-world energy (fuel only). */
export const generatorFiat = (wh, litresPerKWh) => realKWh(wh) * litresPerKWh * MOMO.dieselPerL;
/** One line explaining the scale, for notes under prices. */
export const scaleNote = () => `Demo scale ×${MOMO.demoScale}: 1 Wh measured by the Wokwi meters stands for ${MOMO.demoScale} Wh at a real shop. Prices use the real-world energy; the blockchain keeps the measured Wh.`;
export const depositFiat = (maxWh) => whToFiat(maxWh || MOMO.tradeMaxWh);

/** Stable, readable reference id per trade and record type (looks like a payment reference, clearly ours). */
export function momoRef(kind, id) {
  let h = 2166136261;
  for (const c of `${kind}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return `${kind}-${String(h).padStart(10, '0').slice(0, 8)}`;
}

/**
 * MoMo records for one trade.
 * status values: PENDING (waiting), SUCCESSFUL (done), HELD (deposit frozen by a dispute).
 * shares: { util, plat } in basis points (from the contract).
 */
export function momoForTrade(t, shares) {
  const dep = depositFiat(t.maxWh);
  const recs = [{
    kind: 'deposit', label: 'Deposit from buyer', phone: MOMO.buyerPhone, amount: dep, ref: momoRef('COL', t.id), time: t.openTime,
    status: t.status === 'Disputed' ? 'HELD' : 'SUCCESSFUL', tradeId: t.id,
  }];
  if (t.status === 'Settled') {
    const paid = whToFiat(t.deliveredWh);
    const sellerPart = paid * (10000 - shares.util - shares.plat) / 10000;
    recs.push({ kind: 'payout', label: 'Payout to seller', phone: MOMO.sellerPhone, amount: sellerPart, ref: momoRef('DIS', t.id), time: t.settleTime, status: 'SUCCESSFUL', tradeId: t.id });
    recs.push({ kind: 'refund', label: 'Refund to buyer', phone: MOMO.buyerPhone, amount: Math.max(0, dep - paid), ref: momoRef('REF', t.id), time: t.settleTime, status: 'SUCCESSFUL', tradeId: t.id });
    recs.push({ kind: 'fees', label: 'Utility + Aegis fees', phone: '—', amount: paid * (shares.util + shares.plat) / 10000, ref: momoRef('FEE', t.id), time: t.settleTime, status: 'SUCCESSFUL', tradeId: t.id });
  } else if (t.status === 'Refunded') {
    recs.push({ kind: 'refund', label: 'Full refund to buyer', phone: MOMO.buyerPhone, amount: dep, ref: momoRef('REF', t.id), time: t.refundTime, status: 'SUCCESSFUL', tradeId: t.id });
  } else if (t.status === 'Open') {
    recs.push({ kind: 'payout', label: 'Payout to seller', phone: MOMO.sellerPhone, amount: null, ref: momoRef('DIS', t.id), time: null, status: 'PENDING', tradeId: t.id });
  }
  return recs;
}
