// Landing page entry: the 3D story plus a small live strip read from the escrow contract.
import { ethers } from 'ethers';
import { startScene } from './scene.js';
import { CHAIN, addrUrl } from '../lib/config.js';
import { impact } from '../lib/format.js';

startScene();
showLiveStats();
signedInLinks();

/** Signed in already: the sign up / log in buttons become "Open dashboard". */
function signedInLinks() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('aegis.session') || 'null'); } catch { /* storage blocked */ }
  if (!s || s.method === 'guest') return;
  document.querySelectorAll('[data-auth]').forEach((a) => {
    const k = a.dataset.auth;
    if (k === 'login' || k === 'guest') { a.hidden = true; return; }
    a.href = './console.html';
    if (k === 'rail') { a.dataset.tip = 'Open dashboard'; a.setAttribute('aria-label', 'Open dashboard'); } else a.textContent = 'Open dashboard';
  });
}

/** Two cheap view calls; the page works the same if the RPC is unreachable. */
async function showLiveStats() {
  const box = document.getElementById('liveStats');
  if (!box) return;
  try {
    const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, CHAIN.chainId, { staticNetwork: true });
    const escrow = new ethers.Contract(CHAIN.escrow, [
      'function totalDeliveredWh() view returns (uint256)',
      'function nextTradeId() view returns (uint256)',
    ], provider);
    const [delivered, next] = await Promise.all([escrow.totalDeliveredWh(), escrow.nextTradeId()]);
    const deliveredWh = Number(delivered);
    const trades = Number(next) - 1;
    const { litres } = impact(deliveredWh);
    document.getElementById('liveText').textContent =
      `Live on ${CHAIN.chainId === 84532 ? 'Base Sepolia' : `chain ${CHAIN.chainId}`}: ${trades} trade${trades === 1 ? '' : 's'}, ${deliveredWh.toLocaleString('en-US')} Wh delivered, about ${litres.toFixed(2)} L of diesel avoided (simulated meters).`;
    const link = document.getElementById('liveLink');
    link.href = addrUrl(CHAIN.escrow);
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}
