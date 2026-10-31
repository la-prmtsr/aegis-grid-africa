// Sign up, log in and "what do you need today?" for the Aegis-Grid prototype.
// Routes: #signup, #login, #created, #role (users) and #operator (operator team, demo account).
// Accounts are kept in this browser (see lib/session.js).
import { ethers } from 'ethers';
import { ACCOUNTS, CHAIN, OPERATOR_HASH, addrUrl } from '../lib/config.js';
import { esc, short } from '../lib/format.js';
import {
  normalizePhone, splitPhone, maskPhone, findAccount, createAccount, checkPassword, momoAccount,
  getSession, setSession, updateSession, clearSession, initials, METHOD_LABEL,
} from '../lib/session.js';
import { KNOWN, discover, providerFor, others, iconFor } from '../lib/wallets.js';
import { COUNTRIES, DEFAULT_COUNTRY, countryByIso } from '../lib/countries.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const sheet = $('sheet'), sheetBody = $('sheetBody');
const AREAS = ['Madina', 'Adenta', 'East Legon', 'Spintex', 'Teshie', 'Nungua', 'Dansoman', 'Kaneshie', 'Achimota', 'Dome', 'Lapaz', 'Osu', 'Labadi', 'Tema Community 25', 'Kasoa'];

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
// Wallet icons: the wallet's own icon when it announces itself (EIP-6963, supplied by the installed wallet);
// otherwise a plain letter tile. We do not redraw wallet logos ourselves.
const letterTile = (ch, bg) => `<span class="ltile" style="background:${bg}">${ch}</span>`;
// Not installed: the official logo file from the wallet's brand kit if the team put it in public/wallets/
// (metamask.png, coinbase.svg), else the letter tile.
const walletIcon = (rdns, ch, bg, file) => {
  const src = iconFor(rdns);
  if (src) return `<img src="${esc(src)}" alt="">`;
  return `<img src="./wallets/${file}" alt="" onerror="this.outerHTML=this.nextElementSibling.innerHTML"><template>${letterTile(ch, bg)}</template>`;
};

// ------------------------------------------------------------------ helpers
let pendingPhone = ''; // +E.164 number carried between the forms
let otp = null; // simulated one-time code
let walletBusy = false;

const field = (id, label, input, hint = '') => `<label class="field" for="${id}"><span>${label}</span>${input}${hint ? `<small id="${id}-hint">${hint}</small>` : ''}<em class="err" id="${id}-err"></em></label>`;
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
function savedCountry() { try { return localStorage.getItem('aegis.cc') || DEFAULT_COUNTRY; } catch { return DEFAULT_COUNTRY; } }
/** Phone field with a country code picker (lib/countries.js); `e164` prefills both parts. */
function phoneInput(id, e164 = '') {
  const { iso, national } = e164 ? splitPhone(e164) : { iso: savedCountry(), national: '' };
  const c = countryByIso(iso);
  const opts = COUNTRIES.map((x) => `<option value="${x.iso}" ${x.iso === c.iso ? 'selected' : ''}>${esc(x.name)} (+${x.dial})</option>`).join('');
  return `<div class="phone"><label class="cc" title="Country code"><b>${c.iso}</b>+${c.dial}${CHEVRON}<select id="${id}-cc" aria-label="Country code" data-phone="${id}">${opts}</select></label><input id="${id}" name="${id}" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="${esc(c.eg)}" value="${esc(national)}" required></div>`;
}
/** +E.164 from a phone field and its country picker, or null. */
const readPhone = (id) => normalizePhone($(id)?.value, $(`${id}-cc`)?.value || DEFAULT_COUNTRY);
/** "Enter a valid Ghana number: 9 digits after +233." */
function phoneError(id) {
  const c = countryByIso($(`${id}-cc`)?.value);
  const n = c.len[0] === c.len[1] ? `${c.len[0]}` : `${c.len[0]}–${c.len[1]}`;
  return `Enter a valid ${c.name} number: ${n} digits after +${c.dial}, e.g. ${c.eg}.`;
}
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('select[data-phone]');
  if (!sel) return;
  const c = countryByIso(sel.value);
  sel.parentElement.firstChild.textContent = c.iso; // <b>
  sel.parentElement.childNodes[1].textContent = `+${c.dial}`;
  const input = $(sel.dataset.phone);
  if (input) { input.placeholder = c.eg; input.focus(); }
  try { localStorage.setItem('aegis.cc', c.iso); } catch { /* private mode */ }
});
const passInput = (id, ac) => `<div class="pass"><input id="${id}" name="${id}" type="password" autocomplete="${ac}" minlength="8" required><button type="button" class="eye" data-act="eye" data-for="${id}" aria-label="Show password">${EYE}</button></div>`;
function setErr(id, msg) { const e = $(`${id}-err`); if (e) e.textContent = msg || ''; const i = $(id); if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
function clearErrs(form) { form.querySelectorAll('.err').forEach((e) => { e.textContent = ''; }); form.querySelectorAll('[aria-invalid]').forEach((i) => i.setAttribute('aria-invalid', 'false')); }
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

function signedInNote() {
  const s = getSession();
  if (!s) return '';
  return `<div class="note-in"><span class="av">${esc(initials(s.name))}</span><div>Signed in as <b>${esc(s.name)}</b><small>${esc(METHOD_LABEL[s.method] || '')}</small></div><a class="link" href="./console.html">Open dashboard</a><button type="button" class="link" data-act="logout">Log out</button></div>`;
}

// ------------------------------------------------------------------ views
const WALLET_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><circle cx="16.5" cy="13.5" r="1.5"/></svg>';
const USER_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const OPS_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5.5 3.4 9.7 8 11 4.6-1.3 8-5.5 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>';
/** Who is signing in: households and shops (sign up / log in), or the operator team (fixed demo account). */
const audienceTabs = (active) => `<nav class="aud" aria-label="Sign in as">
    <a href="#login" class="${active === 'user' ? 'on' : ''}" ${active === 'user' ? 'aria-current="page"' : ''}>${USER_ICO}User</a>
    <a href="#operator" class="${active === 'ops' ? 'on' : ''}" ${active === 'ops' ? 'aria-current="page"' : ''}>${OPS_ICO}Operator</a>
  </nav>`;

function signupView() {
  return `
  ${audienceTabs('user')}
  ${signedInNote()}
  <h1>Create your account</h1>
  <p class="sub">Takes a minute. We create your Aegis wallet for you, no crypto knowledge needed.</p>
  <button type="button" class="btn btn-momo wide" data-act="momo-start"><span class="mdot">M</span>Sign up faster with MoMo</button>
  <div class="or"><span>or fill in your details</span></div>
  <form id="signupForm" novalidate>
    ${field('name', 'Full name', '<input id="name" name="name" autocomplete="name" placeholder="Your full name" required>')}
    ${field('phone', 'Phone number (your MoMo number)', phoneInput('phone', pendingPhone), 'You will log in with this number.')}
    ${field('area', 'Neighbourhood', `<input id="area" name="area" list="areas" autocomplete="address-level2" placeholder="e.g. Madina, Accra" required><datalist id="areas">${AREAS.map((a) => `<option value="${a}">`).join('')}</datalist>`, 'Only used to match you with batteries on your street. Your house address is never shown.')}
    ${field('pw', 'Password', passInput('pw', 'new-password'), 'At least 8 characters. It also locks your wallet.')}
    ${field('pw2', 'Confirm password', passInput('pw2', 'new-password'))}
    <div class="exists" id="exists" hidden></div>
    <button class="btn btn-dark wide" type="submit" id="signupBtn">Create account</button>
    <div class="progress" id="progress" hidden><i id="bar"></i><span id="progressText">Creating your secure wallet…</span></div>
  </form>
  <p class="switch">Already have an account? <a href="#login">Log in</a></p>`;
}

function loginView() {
  return `
  ${audienceTabs('user')}
  ${signedInNote()}
  <h1>Welcome back</h1>
  <p class="sub">Log in with your phone number, MoMo or a crypto wallet.</p>
  <form id="loginForm" novalidate>
    ${field('lphone', 'Phone number', phoneInput('lphone', pendingPhone))}
    ${field('lpw', 'Password', passInput('lpw', 'current-password'))}
    <div class="exists" id="lmsg" hidden></div>
    <button class="btn btn-dark wide" type="submit" id="loginBtn">Log in</button>
    <div class="progress" id="progress" hidden><i id="bar"></i><span id="progressText">Unlocking your wallet…</span></div>
  </form>
  <div class="or"><span>or</span></div>
  <button type="button" class="btn btn-line wide" data-act="wallets">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><circle cx="16.5" cy="13.5" r="1.5"/></svg>
    Connect a wallet</button>
  <p class="switch">New here? <a href="#signup">Create an account</a></p>`;
}

function createdView() {
  const s = getSession();
  if (!s) return loginView();
  return `
  <div class="done-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></div>
  <h1>Welcome, ${esc(firstName(s.name))}</h1>
  <p class="sub">Your account is ready, and so is your wallet.</p>
  <div class="wallet-card">
    <div class="wc-top"><span class="wc-h">${WALLET_ICO}Your Aegis wallet</span><span class="wc-net">Base Sepolia</span></div>
    <div class="wc-addr mono" title="${esc(s.address)}">${esc(short(s.address))}</div>
    <div class="wc-rows"><div class="wc-row"><span>Phone</span><b>${esc(maskPhone(s.phone))}</b></div>
    <div class="wc-row"><span>Neighbourhood</span><b>${esc(s.area || '–')}</b></div></div>
    <div class="wc-links"><button type="button" data-act="copy" data-v="${esc(s.address)}">Copy address</button><a href="${addrUrl(s.address)}" target="_blank" rel="noopener">View on explorer</a></div>
  </div>
  <p class="fine">${s.method === 'momo'
    ? 'Payments go through your MoMo. The wallet keeps the record of every trade on Base.'
    : 'Only your password can open this wallet. Aegis never sees the password. Prototype: the wallet is stored in this browser.'}</p>
  <button type="button" class="btn btn-green wide" data-act="to-role">Continue</button>`;
}

function roleView() {
  const s = getSession();
  if (!s) return loginView();
  if (s.method === 'operator') { location.replace('./console.html#o-overview'); return ''; }
  const suggested = s.role || (same(s.address, ACCOUNTS.seller.address) ? 'seller' : 'buyer');
  return `
  <h1>Hi ${esc(firstName(s.name))}, what brings you here?</h1>
  <p class="sub">Pick one to start. You can switch between buying and selling any time from the top bar.</p>
  <div class="roles">
    <button type="button" class="role ${suggested === 'buyer' ? 'sug' : ''}" data-act="role" data-role="buyer">
      <span class="ri ri-buy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg></span>
      <span class="rt"><b>I need power</b><span>Buy backup electricity from a neighbour's battery when the grid goes down. Pay with MoMo, only for what you use.</span></span>
      <span class="rgo" aria-hidden="true">→</span>
    </button>
    <button type="button" class="role ${suggested === 'seller' ? 'sug' : ''}" data-act="role" data-role="seller">
      <span class="ri ri-sell"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="18" rx="2"/><path d="M10 2h4M10 13l2-3v6l2-3"/></svg></span>
      <span class="rt"><b>I have a battery to share</b><span>Earn from the solar energy your battery stores. Your home always keeps its own reserve, and earnings go to your MoMo.</span></span>
      <span class="rgo" aria-hidden="true">→</span>
    </button>
  </div>
`;
}

/** Operator team: no sign up, one fixed team account (credentials kept by the team, only their hash is in the code). */
function operatorView() {
  return `
  ${audienceTabs('ops')}
  <h1>Operator sign-in</h1>
  <p class="sub">For the Aegis operations team: the street microgrid, the dual-meter oracle, mobile money and the escrow.</p>
  <form id="opsForm" novalidate>
    ${field('ouser', 'Username', '<input id="ouser" name="ouser" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="Operator username" required>')}
    ${field('opw', 'Password', `<div class="pass"><input id="opw" name="opw" type="password" autocomplete="current-password" placeholder="Password" required><button type="button" class="eye" data-act="eye" data-for="opw" aria-label="Show password">${EYE}</button></div>`)}
    <button class="btn btn-dark wide" type="submit">Log in as operator</button>
  </form>
  <p class="fine">Operator accounts are issued by the Aegis team; there is no sign-up. Households and shops use the User tab.</p>`;
}

const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

let routed = false; // first render pops in (CSS), later route changes do a small swap
function route() {
  const h = (location.hash || '#signup').slice(1);
  const views = { signup: signupView, login: loginView, created: createdView, role: roleView, operator: operatorView };
  view.innerHTML = (views[h] || signupView)();
  view.dataset.view = views[h] ? h : 'signup';
  view.classList.remove('swap'); void view.offsetWidth; if (routed) view.classList.add('swap'); routed = true;
  document.title = `Aegis-Grid · ${{ signup: 'Create account', login: 'Log in', created: 'Welcome', role: 'Get started', operator: 'Operator sign-in' }[view.dataset.view]}`;
  view.querySelector('h1')?.focus?.();
  window.scrollTo({ top: 0 });
}
addEventListener('hashchange', route);

// ------------------------------------------------------------------ sign up
view.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  clearErrs(f);
  if (f.id === 'signupForm') return signup(f);
  if (f.id === 'loginForm') return login(f);
  if (f.id === 'opsForm') return operatorLogin(f);
  return undefined;
});

async function signup(f) {
  const name = f.name.value.trim(), area = f.area.value.trim(), pw = f.pw.value, pw2 = f.pw2.value;
  const phone = readPhone('phone');
  let bad = false;
  if (name.length < 2) { setErr('name', 'Enter your name.'); bad = true; }
  if (!phone) { setErr('phone', phoneError('phone')); bad = true; }
  if (!area) { setErr('area', 'Choose your neighbourhood.'); bad = true; }
  if (pw.length < 8) { setErr('pw', 'Use at least 8 characters.'); bad = true; }
  if (pw2 !== pw) { setErr('pw2', 'The two passwords are different.'); bad = true; }
  if (bad) { f.querySelector('[aria-invalid="true"]')?.focus(); return; }
  if (findAccount(phone)) return showExists(phone);

  busy(true, 'Creating your secure wallet…');
  try {
    const acc = await createAccount({ name, phone, area, password: pw }, (p) => progress(p));
    setSession({ name: acc.name, phone: acc.phone, area: acc.area, method: 'password', address: acc.address });
    go('#created');
  } catch (err) {
    busy(false);
    if (err.code === 'EXISTS') showExists(phone); else setErr('pw2', err.message);
  }
}

function showExists(phone) {
  pendingPhone = phone;
  const box = $('exists');
  box.hidden = false;
  box.innerHTML = `<b>This number already has an account.</b> <a href="#login">Log in instead →</a>`;
  setErr('phone', ' ');
}

function busy(on, text) {
  const btn = view.querySelector('form button[type="submit"]');
  if (btn) btn.disabled = on;
  view.querySelectorAll('form input').forEach((i) => { i.readOnly = on; });
  const pr = $('progress');
  if (pr) { pr.hidden = !on; if (text) $('progressText').textContent = text; $('bar').style.width = '4%'; }
}
function progress(p) { const b = $('bar'); if (b) b.style.width = `${Math.max(4, Math.round(p * 100))}%`; }

// ------------------------------------------------------------------ log in
async function login(f) {
  const phone = readPhone('lphone'), pw = f.lpw.value;
  const msg = $('lmsg'); msg.hidden = true;
  if (!phone) { setErr('lphone', phoneError('lphone')); return; }
  if (!pw) { setErr('lpw', 'Enter your password.'); return; }
  const acc = findAccount(phone);
  if (!acc) {
    pendingPhone = phone;
    msg.hidden = false;
    msg.innerHTML = `<b>No account for this number on this device.</b> <a href="#signup">Create one →</a>`;
    return;
  }
  if (acc.method === 'momo') {
    msg.hidden = false;
    msg.innerHTML = `<b>This number signs in with MoMo.</b> <button type="button" class="link" data-act="momo-start" data-phone="${esc(phone)}">Continue with MoMo →</button>`;
    return;
  }
  busy(true, 'Unlocking your wallet…');
  try {
    await checkPassword(phone, pw, (p) => progress(p));
    setSession({ name: acc.name, phone: acc.phone, area: acc.area, method: 'password', address: acc.address, role: acc.role });
    go('#role');
  } catch (err) {
    busy(false);
    setErr('lpw', err.message);
    f.lpw.focus();
  }
}

// ------------------------------------------------------------------ operator
function operatorLogin(f) {
  const user = f.ouser.value.trim().toLowerCase(), pw = f.opw.value;
  if (!user) { setErr('ouser', 'Enter the operator username.'); f.ouser.focus(); return; }
  if (!pw) { setErr('opw', 'Enter the password.'); f.opw.focus(); return; }
  const hash = ethers.sha256(ethers.toUtf8Bytes(`${user}:${pw}`)).slice(2);
  if (hash !== OPERATOR_HASH) {
    setErr('opw', 'Wrong username or password.');
    f.opw.select();
    return;
  }
  setSession({ name: 'Aegis Operator', method: 'operator', role: 'ops' });
  try { localStorage.setItem('aegis.persona', 'ops'); } catch { /* private mode */ }
  location.href = './console.html#o-overview';
}

// ------------------------------------------------------------------ sheet: wallets + MoMo
function openSheet(html) {
  sheetBody.innerHTML = html;
  sheet.hidden = false;
  document.body.classList.add('locked');
  requestAnimationFrame(() => sheet.classList.add('on'));
  setTimeout(() => sheetBody.querySelector('input,button.opt')?.focus(), 60);
}
function closeSheet() {
  sheet.classList.remove('on');
  document.body.classList.remove('locked');
  setTimeout(() => { sheet.hidden = true; sheetBody.innerHTML = ''; }, 200);
}
const sheetHead = (title, back) => `<div class="sh-head">${back ? `<button type="button" class="icon-btn" data-act="${back}" aria-label="Back">←</button>` : '<span></span>'}<h2 id="sheetTitle">${title}</h2><button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close">✕</button></div>`;

async function walletList() {
  openSheet(`${sheetHead('Connect a wallet')}<p class="sh-sub">Checking which wallets this browser has…</p>`);
  await discover();
  const opt = (act, icon, name, desc, extra = '', attrs = '') => `<button type="button" class="opt" data-act="${act}" ${attrs}><span class="oi">${icon}</span><span class="ot"><b>${name}</b><small>${desc}</small></span>${extra}</button>`;
  const mm = !!providerFor(KNOWN.metamask.rdns), cb = !!providerFor(KNOWN.coinbase.rdns);
  const tag = (ok) => `<span class="tag ${ok ? 'ok' : ''}">${ok ? 'Detected' : 'Not installed'}</span>`;
  const more = others().map((w) => opt('wallet', `<img src="${esc(w.info.icon)}" alt="">`, esc(w.info.name), 'Browser wallet', '<span class="tag ok">Detected</span>', `data-rdns="${esc(w.info.rdns)}" data-name="${esc(w.info.name)}"`)).join('');
  sheetBody.innerHTML = `${sheetHead('Connect a wallet')}
    <p class="sh-sub">Choose how you want to sign in.</p>
    <div class="opts">
      ${opt('momo-start', '<span class="mdot big">M</span>', 'MoMo', 'Mobile money · recommended in Ghana', '<span class="tag sim">Simulated</span>')}
      ${opt('wallet', walletIcon(KNOWN.metamask.rdns, 'M', '#E8831D', 'metamask.png'), 'MetaMask', 'Browser extension or app', tag(mm), `data-rdns="${KNOWN.metamask.rdns}" data-name="MetaMask"`)}
      ${opt('wallet', walletIcon(KNOWN.coinbase.rdns, 'C', '#1652F0', 'coinbase.svg'), 'Coinbase Wallet', 'Browser extension or app', tag(cb), `data-rdns="${KNOWN.coinbase.rdns}" data-name="Coinbase Wallet"`)}
      ${more}
    </div>
    <p class="sh-fine">Crypto wallets use the Base Sepolia test network. Use a testnet account only.</p>`;
}

async function connectBrowserWallet(rdns, name) {
  if (walletBusy) return;
  const p = providerFor(rdns);
  if (!p) {
    const k = Object.values(KNOWN).find((x) => x.rdns === rdns);
    sheetBody.innerHTML = `${sheetHead(name, 'wallets')}
      <p class="sh-sub">${esc(name)} is not installed in this browser.</p>
      ${k ? `<a class="btn btn-dark wide" href="${k.install}" target="_blank" rel="noopener">Get ${esc(name)}</a>` : ''}
      <p class="sh-fine">On a phone, open this page inside the ${esc(name)} app's browser. Or go back and continue with MoMo.</p>`;
    return;
  }
  walletBusy = true;
  sheetBody.innerHTML = `${sheetHead(name, 'wallets')}<div class="wait"><span class="spin"></span><b>Check ${esc(name)}</b><small>Approve the connection in the wallet window.</small></div>`;
  try {
    const [addr] = await p.request({ method: 'eth_requestAccounts' });
    const hex = '0x' + CHAIN.chainId.toString(16);
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); } catch (err) {
      if (err.code === 4902 && CHAIN.chainId === 84532) {
        await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: 'Base Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [CHAIN.rpcUrl], blockExplorerUrls: [CHAIN.explorer] }] });
      } else if (err.code === 4001) throw err;
    }
    const address = ethers.getAddress(addr);
    const demo = same(address, ACCOUNTS.buyer.address) ? ACCOUNTS.buyer : same(address, ACCOUNTS.seller.address) ? ACCOUNTS.seller : null;
    setSession({ name: demo ? demo.name : `${name} ${short(address)}`, method: 'wallet', walletName: name, rdns, address, role: demo === ACCOUNTS.seller ? 'seller' : demo ? 'buyer' : undefined });
    closeSheet();
    go('#role');
  } catch (err) {
    const msg = err?.code === 4001 ? 'You cancelled the request in the wallet.' : err?.code === -32002 ? `${name} already has a request waiting. Open the extension and answer it.` : (err?.message || 'Could not connect.');
    sheetBody.innerHTML = `${sheetHead(name, 'wallets')}<div class="wait bad"><b>Not connected</b><small>${esc(msg)}</small></div><button type="button" class="btn btn-dark wide" data-act="wallet" data-rdns="${esc(rdns)}" data-name="${esc(name)}">Try again</button>`;
  } finally {
    walletBusy = false;
  }
}

// MoMo (simulated): phone -> one-time code -> (new users) name + neighbourhood -> signed in
function momoPhone(prefill = '') {
  const html = `${sheetHead('Continue with MoMo', 'wallets')}
    <div class="momo-brand"><span class="mdot big">M</span><div><b>Mobile money</b><small>We will text a code to your MoMo number.</small></div><span class="tag sim">Simulated</span></div>
    <form id="momoPhoneForm" novalidate>
      ${field('mphone', 'MoMo number', phoneInput('mphone', prefill))}
      <button class="btn btn-momo wide" type="submit">Send code</button>
    </form>
    <p class="sh-fine">Prototype: no SMS is sent and no MoMo account is checked. In production Aegis would check that the number is an active MoMo account first.</p>`;
  if (sheet.hidden) openSheet(html); else { sheetBody.innerHTML = html; sheetBody.querySelector('input')?.focus(); }
}

function momoOtp() {
  otp = String(Math.floor(100000 + Math.random() * 900000));
  sheetBody.innerHTML = `${sheetHead('Enter the code', 'momo-start')}
    <div class="sms" role="note"><small>Simulated SMS to ${esc(maskPhone(pendingPhone))}</small><b>Aegis-Grid: your code is ${otp}. It expires in 5 minutes.</b></div>
    <form id="momoOtpForm" novalidate>
      ${field('code', '6-digit code', '<input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" class="otp" placeholder="••••••" required>')}
      <button class="btn btn-momo wide" type="submit">Verify</button>
    </form>
    <p class="sh-fine">Wrong number? <button type="button" class="link" data-act="momo-start">Change it</button></p>`;
  sheetBody.querySelector('#code').focus();
}

function momoProfile() {
  sheetBody.innerHTML = `${sheetHead('One last step', 'momo-start')}
    <p class="sh-sub">New number. Tell us who you are and we create your account and wallet.</p>
    <form id="momoProfileForm" novalidate>
      ${field('mname', 'Name on your MoMo account', '<input id="mname" name="mname" autocomplete="name" placeholder="Name as shown on MoMo" required>')}
      ${field('marea', 'Neighbourhood', `<input id="marea" name="marea" list="mareas" placeholder="e.g. Madina, Accra" required><datalist id="mareas">${AREAS.map((a) => `<option value="${a}">`).join('')}</datalist>`)}
      <button class="btn btn-momo wide" type="submit">Create account</button>
    </form>`;
  sheetBody.querySelector('#mname').focus();
}

sheetBody.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  clearErrs(f);
  if (f.id === 'momoPhoneForm') {
    const phone = readPhone('mphone');
    if (!phone) return setErr('mphone', phoneError('mphone'));
    pendingPhone = phone;
    return momoOtp();
  }
  if (f.id === 'momoOtpForm') {
    if (f.code.value.trim() !== otp) return setErr('code', 'That code is not right. Check the SMS above.');
    const acc = findAccount(pendingPhone);
    if (!acc) return momoProfile();
    setSession({ name: acc.name, phone: acc.phone, area: acc.area, method: 'momo', address: acc.address, role: acc.role });
    closeSheet();
    return go('#role');
  }
  if (f.id === 'momoProfileForm') {
    const name = f.mname.value.trim(), area = f.marea.value.trim();
    if (name.length < 2) return setErr('mname', 'Enter your name.');
    if (!area) return setErr('marea', 'Choose your neighbourhood.');
    const acc = momoAccount(pendingPhone, name, area);
    setSession({ name: acc.name, phone: acc.phone, area: acc.area, method: 'momo', address: acc.address });
    closeSheet();
    return go('#created');
  }
  return undefined;
});

// ------------------------------------------------------------------ clicks
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'eye') {
    const i = $(b.dataset.for);
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    b.classList.toggle('on', show);
  } else if (act === 'wallets') walletList();
  else if (act === 'wallet') connectBrowserWallet(b.dataset.rdns, b.dataset.name);
  else if (act === 'momo-start') {
    const typedId = view.querySelector('#phone, #lphone')?.id;
    const pre = b.dataset.phone || (typedId ? readPhone(typedId) : '') || '';
    momoPhone(pre || '');
  } else if (act === 'sheet-close') closeSheet();
  else if (act === 'to-role') go('#role');
  else if (act === 'copy') { navigator.clipboard?.writeText(b.dataset.v).then(() => { b.textContent = 'Copied'; }, () => {}); }
  else if (act === 'logout') { clearSession(); route(); }
  else if (act === 'role') {
    const role = b.dataset.role;
    updateSession({ role });
    try {
      localStorage.setItem('aegis.persona', role === 'ops' ? 'ops' : role === 'seller' ? 'kwame' : 'ama');
      localStorage.setItem('aegis.mode', role === 'seller' ? 'seller' : 'buyer');
    } catch { /* private mode */ }
    location.href = './console.html';
  }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

// background parallax: the street moves a few pixels against the pointer
const move = document.querySelector('.scene-move');
if (move && !matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(pointer: fine)').matches) {
  addEventListener('pointermove', (e) => {
    const x = (e.clientX / innerWidth - 0.5) * -22, y = (e.clientY / innerHeight - 0.5) * -14;
    move.style.setProperty('--px', `${x.toFixed(1)}px`); move.style.setProperty('--py', `${y.toFixed(1)}px`);
  }, { passive: true });
}

route();
