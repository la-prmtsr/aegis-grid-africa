// Sign up, log in and "what do you need today?" for the Aegis-Grid prototype.
// Routes: #signup, #login, #created, #role. Accounts are kept in this browser (see lib/session.js).
import { ethers } from 'ethers';
import { ACCOUNTS, CHAIN } from '../lib/config.js';
import { esc, short } from '../lib/format.js';
import {
  normalizePhone, prettyPhone, maskPhone, findAccount, createAccount, checkPassword, momoAccount,
  getSession, setSession, updateSession, clearSession, initials, METHOD_LABEL,
} from '../lib/session.js';
import { KNOWN, discover, providerFor, others } from '../lib/wallets.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const sheet = $('sheet'), sheetBody = $('sheetBody');
const AREAS = ['Madina', 'Adenta', 'East Legon', 'Spintex', 'Teshie', 'Nungua', 'Dansoman', 'Kaneshie', 'Achimota', 'Dome', 'Lapaz', 'Osu', 'Labadi', 'Tema Community 25', 'Kasoa'];

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const MM_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M27 4 17.5 11l1.8-4.2L27 4Z" fill="#E2761B"/><path d="m5 4 9.4 7.1-1.7-4.3L5 4Zm18.6 16.4-2.5 3.9 5.4 1.5 1.6-5.3-4.5-.1Zm-20.1.1 1.5 5.3 5.4-1.5-2.5-3.9-4.4.1Z" fill="#E4761B"/><path d="m9.5 13.9-1.5 2.3 5.4.2-.2-5.8-3.7 3.3Zm13 0-3.8-3.4-.1 5.9 5.4-.2-1.5-2.3ZM9.9 24.3l3.2-1.6-2.8-2.2-.4 3.8Zm8.9-1.6 3.3 1.6-.5-3.8-2.8 2.2Z" fill="#E4761B"/><path d="m22 24.3-3.2-1.6.3 2.1v.9l2.9-1.4Zm-12.1 0 3 1.4v-.9l.2-2.1-3.2 1.6Z" fill="#D7C1B3"/><path d="m13 19.2-2.7-.8 1.9-.9.8 1.7Zm6 0 .8-1.7 1.9.9-2.7.8Z" fill="#233447"/><path d="m9.9 24.3.5-3.9-3 .1 2.5 3.8Zm11.7-3.9.5 3.9 2.5-3.8-3-.1Zm2.3-4.2-5.4.2.5 2.8.8-1.7 1.9.9 2.2-2.2Zm-13.6 2.2 1.9-.9.8 1.7.5-2.8-5.4-.2 2.2 2.2Z" fill="#CD6116"/></svg>';
const CB_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0052FF"/><circle cx="16" cy="16" r="9" fill="#fff"/><rect x="12.5" y="12.5" width="7" height="7" rx="1.2" fill="#0052FF"/></svg>';

// ------------------------------------------------------------------ helpers
let pendingPhone = '';
let otp = null; // simulated one-time code
let walletBusy = false;

const field = (id, label, input, hint = '') => `<label class="field" for="${id}"><span>${label}</span>${input}${hint ? `<small id="${id}-hint">${hint}</small>` : ''}<em class="err" id="${id}-err"></em></label>`;
const phoneInput = (id, value = '') => `<div class="phone"><span class="cc">🇬🇭 +233</span><input id="${id}" name="${id}" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="24 123 4567" value="${esc(value)}" required></div>`;
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
function signupView() {
  return `
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
    Connect a wallet <span class="mini" aria-hidden="true"><span class="mdot">M</span>${MM_ICON}${CB_ICON}</span></button>
  <p class="switch">New here? <a href="#signup">Create an account</a></p>
  <p class="switch small"><button type="button" class="link" data-act="guest">Just looking? Explore the demo street as a guest</button></p>`;
}

function createdView() {
  const s = getSession();
  if (!s) return loginView();
  return `
  <div class="done-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></div>
  <h1>Welcome, ${esc(firstName(s.name))}</h1>
  <p class="sub">Your account is ready, and so is your wallet.</p>
  <div class="wallet-card">
    <div class="wc-top"><span>Your Aegis wallet</span><span class="pill">${s.method === 'momo' ? 'Linked to MoMo · simulated' : 'Locked with your password'}</span></div>
    <div class="wc-addr mono" title="${esc(s.address)}">${esc(short(s.address))}</div>
    <div class="wc-row"><span>Phone</span><b>${esc(maskPhone(s.phone))}</b></div>
    <div class="wc-row"><span>Neighbourhood</span><b>${esc(s.area || '–')}</b></div>
    <button type="button" class="link" data-act="copy" data-v="${esc(s.address)}">Copy address</button>
  </div>
  <p class="fine">${s.method === 'momo'
    ? 'Payments go through your MoMo. The wallet keeps the record of every trade on Base.'
    : 'Only your password can open this wallet. Aegis never sees the password. Prototype: the wallet is stored in this browser.'}</p>
  <button type="button" class="btn btn-green wide" data-act="to-role">Continue</button>`;
}

function roleView() {
  const s = getSession();
  if (!s) return loginView();
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
  <p class="switch small"><button type="button" class="link" data-act="role" data-role="ops">Operator view (demo team)</button></p>`;
}

const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function route() {
  const h = (location.hash || '#signup').slice(1);
  const views = { signup: signupView, login: loginView, created: createdView, role: roleView };
  view.innerHTML = (views[h] || signupView)();
  view.dataset.view = views[h] ? h : 'signup';
  document.title = `Aegis-Grid · ${{ signup: 'Create account', login: 'Log in', created: 'Welcome', role: 'Get started' }[view.dataset.view]}`;
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
  return undefined;
});

async function signup(f) {
  const name = f.name.value.trim(), area = f.area.value.trim(), pw = f.pw.value, pw2 = f.pw2.value;
  const phone = normalizePhone(f.phone.value);
  let bad = false;
  if (name.length < 2) { setErr('name', 'Enter your name.'); bad = true; }
  if (!phone) { setErr('phone', 'Enter a Ghana number, e.g. 24 123 4567.'); bad = true; }
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
  pendingPhone = prettyPhone(phone).replace('+233 ', '');
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
  const phone = normalizePhone(f.lphone.value), pw = f.lpw.value;
  const msg = $('lmsg'); msg.hidden = true;
  if (!phone) { setErr('lphone', 'Enter a Ghana number, e.g. 24 123 4567.'); return; }
  if (!pw) { setErr('lpw', 'Enter your password.'); return; }
  const acc = findAccount(phone);
  if (!acc) {
    pendingPhone = prettyPhone(phone).replace('+233 ', '');
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
      ${opt('wallet', MM_ICON, 'MetaMask', 'Browser extension or app', tag(mm), `data-rdns="${KNOWN.metamask.rdns}" data-name="MetaMask"`)}
      ${opt('wallet', CB_ICON, 'Coinbase Wallet', 'Browser extension or app', tag(cb), `data-rdns="${KNOWN.coinbase.rdns}" data-name="Coinbase Wallet"`)}
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
    const phone = normalizePhone(f.mphone.value);
    if (!phone) return setErr('mphone', 'Enter a Ghana number, e.g. 24 123 4567.');
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
    const typed = view.querySelector('#phone, #lphone')?.value || '';
    const pre = b.dataset.phone || (typed ? normalizePhone(typed) : '') || '';
    momoPhone(pre ? pre.replace('+233', '') : '');
  } else if (act === 'sheet-close') closeSheet();
  else if (act === 'to-role') go('#role');
  else if (act === 'copy') { navigator.clipboard?.writeText(b.dataset.v).then(() => { b.textContent = 'Copied'; }, () => {}); }
  else if (act === 'guest') {
    setSession({ name: 'Guest', method: 'guest' });
    go('#role');
  } else if (act === 'logout') { clearSession(); route(); }
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

route();
