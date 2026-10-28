// Simulated mobile money (MoMo) layer on top of the real escrow trades.
// Nothing here calls a payment API. Every record is derived from on-chain trade data, so all viewers
// see the same ledger and the USD amounts always match what the contract settled.
//
// Intended production flow (roadmap, see web/README.md):
//   buyer pays deposit via MoMo Collections (requestToPay) -> platform funds openTrade from its float
//   -> TradeSettled -> MoMo Disbursements (transfer) to the seller, refund of unused deposit to the buyer.
import { MOMO } from './config.js';

// Micro-trades are worth cents: keep 2 decimals, show a third one when it carries information ($0.027).
export const usd = (v) => (v == null ? '–' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`);
export const whToUsd = (wh) => (Number(wh || 0) / 1000) * MOMO.usdPerKWh;
export const depositUsd = (maxWh) => whToUsd(maxWh || MOMO.tradeMaxWh);

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
  const dep = depositUsd(t.maxWh);
  const recs = [{
    kind: 'deposit', label: 'Deposit from buyer', phone: MOMO.buyerPhone, amount: dep, ref: momoRef('COL', t.id), time: t.openTime,
    status: t.status === 'Disputed' ? 'HELD' : 'SUCCESSFUL', tradeId: t.id,
  }];
  if (t.status === 'Settled') {
    const paid = whToUsd(t.deliveredWh);
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
