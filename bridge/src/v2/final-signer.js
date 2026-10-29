// Stage 5B.3 gateway signer. Each gateway process (meter-a.js, meter-b.js) holds ONE registered meter key
// and signs ONLY the final event its own Wokwi meter published, and only when the relayer asks for a
// testnet settlement. It never signs a value the relayer supplies, and never signs the other meter's final.
//
// Transparency: the signature is a gateway attestation of a SIMULATED reading. METER_B is derived from
// METER_A in the simulation (independentPhysicalMeasurement:false). Every signed reading carries the
// label SIMULATED_TESTNET_SETTLEMENT.
import { SITE, STAGE5B, topics } from './config.js';
import { validateFinal, chainIdOf, toContractWh, LABEL_TESTNET } from './evidence.js';
import { signReading, chainTimestamp } from './signing.js';

export function createFinalSigner({ meterId, getSigner, publish, log }) {
  const finals = new Map(); // tradeId string -> first valid final
  const signed = new Set(); // on-chain ids already signed

  function onFinal(payload) {
    const v = validateFinal(payload, { site: SITE, topicMeterId: meterId });
    if (!v.ok) return log(`ignored ${meterId} final: ${v.reason}`);
    const f = v.final;
    if (finals.has(f.tradeId)) return log(`ignored duplicate ${meterId} final for trade ${f.tradeId}`);
    finals.set(f.tradeId, f);
    if (finals.size > 200) finals.delete(finals.keys().next().value);
    log(`${meterId} final for trade ${f.tradeId}: ${f.wh} Wh${f.role === 'seller' ? `, battery ${(f.socBpsAfter / 100).toFixed(2)}%` : ''} (unsigned, simulated)`);
  }

  async function onSignRequest(cmd) {
    const id = Number(cmd.tradeId);
    if (STAGE5B.settlementMode !== 'testnet') return log(`refused to sign trade ${id}: SETTLEMENT_MODE=${STAGE5B.settlementMode}`);
    if (signed.has(id)) return log(`trade ${id} already signed`);
    const f = finals.get(String(id));
    if (!f || chainIdOf(f.tradeId) !== id) return log(`refused to sign trade ${id}: no ${meterId} final for this escrow trade`);
    const wh = toContractWh(f.wh);
    if (wh < 1) return log(`refused to sign trade ${id}: whole-Wh reading would be 0`);
    const s = await getSigner();
    const reading = {
      v: 2,
      tradeId: id,
      role: f.role,
      meterId,
      wh, // uint64 sent to the contract: floor of the meter's own value, never adjusted
      ...(f.role === 'seller' ? { socBpsAfter: f.socBpsAfter } : {}),
      whFraction: f.wh,
      reason: f.reason,
      ...(f.role === 'buyer' ? { tamper: Boolean(f.tamper) } : {}),
      source: 'wokwi-final',
      label: LABEL_TESTNET,
      simulated: true,
      independentPhysicalMeasurement: false,
      attestation: 'gateway',
    };
    const out = await signReading(s.wallet, s.domain, reading, await chainTimestamp(s.provider));
    signed.add(id);
    await publish(topics.reading(id, f.role), out, { retain: true });
    log(`trade ${id}: signed ${wh} Wh (from ${f.wh} Wh) as ${LABEL_TESTNET}`);
  }

  return { onFinal, onSignRequest };
}
