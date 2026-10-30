// Accounts and the signed-in session for the prototype.
//
// PROTOTYPE: accounts live in this browser (localStorage). Nothing is sent to a server.
// - Sign up creates a new wallet in the browser and stores it ENCRYPTED with the user's password
//   (standard Ethereum keystore, scrypt). The password itself is never stored; logging in works by
//   decrypting the keystore. In production this moves to a backend or an embedded-wallet service.
// - "Continue with MoMo" is simulated (phone number + one-time code). Its wallet is shown by address.
// - MetaMask / Coinbase Wallet sign in with the wallet the user already has.

import { ethers } from 'ethers';
import { DEFAULT_COUNTRY, countryByIso, countryOf } from './countries.js';

const ACCOUNTS_KEY = 'aegis.accounts';
const SESSION_KEY = 'aegis.session';

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/**
 * Phone number -> +E.164 for the chosen country (lib/countries.js), or null when it does not look valid.
 * Accepts the national number with or without its leading 0 (024 123 4567, 24 123 4567), or a full +number
 * (then the country is taken from the number itself).
 */
export function normalizePhone(input, iso = DEFAULT_COUNTRY) {
  const raw = String(input || '').trim();
  let digits = raw.replace(/\D/g, '');
  let c = countryByIso(iso);
  if (raw.startsWith('+') || raw.startsWith('00')) {
    if (raw.startsWith('00')) digits = digits.slice(2);
    const byNumber = countryOf(digits);
    if (!byNumber) return null;
    c = byNumber;
    digits = digits.slice(c.dial.length);
  } else if (digits.startsWith(c.dial) && digits.length > c.len[1]) {
    digits = digits.slice(c.dial.length); // typed the country code without +
  }
  digits = digits.replace(/^0+/, ''); // trunk prefix
  return digits.length >= c.len[0] && digits.length <= c.len[1] ? `+${c.dial}${digits}` : null;
}
/** Split a stored number into its country and national digits (for prefilling the form). */
export function splitPhone(e164) {
  const c = countryOf(e164);
  return c ? { iso: c.iso, national: String(e164).replace(/^\+/, '').slice(c.dial.length) } : { iso: DEFAULT_COUNTRY, national: '' };
}
/** "+233 24 123 4567": the national digits in groups of 3, the last 4 together. */
export function prettyPhone(p) {
  if (!p) return '';
  const { iso, national } = splitPhone(p);
  const h = national.slice(0, -4);
  const head = [];
  for (let i = h.length; i > 0; i -= 3) head.unshift(h.slice(Math.max(0, i - 3), i)); // groups of 3 from the right
  if (head.length > 1 && head[0].length === 1) head.splice(0, 2, head[0] + head[1]);
  return `+${countryByIso(iso).dial} ${[...head, national.slice(-4)].join(' ')}`;
}
/** "+233 ··· 4567" */
export const maskPhone = (p) => (p ? `+${countryOf(p)?.dial ?? ''} ··· ${String(p).slice(-4)}` : '');

export const findAccount = (phone) => read(ACCOUNTS_KEY, {})[phone] || null;

function saveAccount(acc) {
  const all = read(ACCOUNTS_KEY, {});
  all[acc.phone] = acc;
  write(ACCOUNTS_KEY, all);
}

/** Sign up: create a wallet, encrypt it with the password, store the account. */
export async function createAccount({ name, phone, area, password }, onProgress) {
  if (findAccount(phone)) throw Object.assign(new Error('This number already has an account.'), { code: 'EXISTS' });
  const wallet = ethers.Wallet.createRandom();
  const keystore = await wallet.encrypt(password, onProgress);
  const acc = { name, phone, area, method: 'password', address: wallet.address, keystore, createdAt: Date.now() };
  saveAccount(acc);
  return acc;
}

/** Log in with phone + password: the password is right if it decrypts the stored wallet. */
export async function checkPassword(phone, password, onProgress) {
  const acc = findAccount(phone);
  if (!acc) throw Object.assign(new Error('No account for this number yet.'), { code: 'NO_ACCOUNT' });
  if (!acc.keystore) throw Object.assign(new Error('This number signs in with MoMo.'), { code: 'MOMO_ACCOUNT' });
  try {
    await ethers.Wallet.fromEncryptedJson(acc.keystore, password, onProgress);
  } catch {
    throw Object.assign(new Error('Wrong password.'), { code: 'BAD_PASSWORD' });
  }
  return acc;
}

/** First "Continue with MoMo": the number is the identity; Aegis creates the wallet for it. */
export function momoAccount(phone, name, area) {
  const existing = findAccount(phone);
  if (existing) return existing;
  // Simulated custodial wallet: in production a key service would hold this key. Only the address is kept here.
  const acc = { name, phone, area, method: 'momo', address: ethers.Wallet.createRandom().address, createdAt: Date.now() };
  saveAccount(acc);
  return acc;
}

/**
 * Session shape:
 * { name, phone?, area?, method: 'password'|'momo'|'wallet'|'operator', address?, walletName?, rdns?, role? }
 */
/** The signed-in person, or null. Guest sessions from older builds no longer count (there is no guest mode). */
export const getSession = () => { const s = read(SESSION_KEY, null); return s && s.method !== 'guest' ? s : null; };
export function setSession(s) { write(SESSION_KEY, { ...s, at: Date.now() }); }
export function updateSession(patch) { const s = getSession(); if (s) setSession({ ...s, ...patch }); }
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

/**
 * Short, stable key for the signed-in user: the wallet address (every account has one), else the phone digits.
 * Used to tag the user's trades (app/request "user") and their operator warnings (app/notice/<key>).
 */
export function userKey(s) {
  if (!s) return '';
  if (s.address) return String(s.address).toLowerCase();
  const d = String(s.phone || '').replace(/\D/g, '');
  return d ? `tel${d}` : '';
}
/** What the backend stores about who asked for power: the key, a first name and a masked phone, nothing else. */
export const requesterOf = (s) => (userKey(s) ? { id: userKey(s), name: String(s.name || '').split(' ')[0] || null, phone: s.phone ? maskPhone(s.phone) : null } : null);

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const METHOD_LABEL = { password: 'Aegis account', momo: 'MoMo (simulated)', wallet: 'Browser wallet', operator: 'Operator (demo account)' };
