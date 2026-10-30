// Landing page entry: the 3D story plus a small live strip read from the escrow contract.
import { ethers } from 'ethers';
import { startScene } from './scene.js';
import { CHAIN, addrUrl } from '../lib/config.js';
import { impact } from '../lib/format.js';

startScene();
showLiveStats();
signedInLinks();

/**
 * Signed out: Log in / Sign up everywhere. Signed in: the navbar shows "Log out" where "Log in" was and
 * "Dashboard" where "Sign up" was (same places, so the bar keeps its layout); the hero's "Get started" and the
 * closing "Log in" are hidden so "Open dashboard" is not repeated; the closing "Create your account" and the side
 * rail open the dashboard.
 */
function signedInLinks() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('aegis.session') || 'null'); } catch { /* storage blocked */ }
  if (!s || s.method === 'guest') return; // old guest sessions are not signed in
  document.querySelectorAll('[data-auth]').forEach((a) => {
    const k = a.dataset.auth;
    if (k === 'hide') { a.hidden = true; return; }
    if (k === 'logout') {
      a.textContent = 'Log out';
      a.href = './index.html';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try { localStorage.removeItem('aegis.session'); } catch { /* storage blocked */ }
        location.reload();
      });
      return;
    }
    a.href = './console.html';
    if (k === 'rail') { a.dataset.tip = 'Open dashboard'; a.setAttribute('aria-label', 'Open dashboard'); } else a.textContent = a.closest('nav') ? 'Dashboard' : 'Open dashboard'; // short in the navbar so it fits on phones
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
