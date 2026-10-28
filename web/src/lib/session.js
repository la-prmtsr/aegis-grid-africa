// Accounts and the signed-in session for the prototype.
//
// PROTOTYPE: accounts live in this browser (localStorage). Nothing is sent to a server.
// - Sign up creates a new wallet in the browser and stores it ENCRYPTED with the user's password
//   (standard Ethereum keystore, scrypt). The password itself is never stored; logging in works by
//   decrypting the keystore. In production this moves to a backend or an embedded-wallet service.
// - "Continue with MoMo" is simulated (phone number + one-time code). Its wallet is shown by address.
// - MetaMask / Coinbase Wallet sign in with the wallet the user already has.

import { ethers } from 'ethers';

const ACCOUNTS_KEY = 'aegis.accounts';
const SESSION_KEY = 'aegis.session';

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/** Ghana numbers: accepts 024 123 4567, 24 123 4567 or +233 24 123 4567. Returns +233XXXXXXXXX or null. */
export function normalizePhone(input) {
  const d = String(input || '').replace(/[^\d+]/g, '');
  let local = null;
  if (/^\+233\d{9}$/.test(d)) local = d.slice(4);
  else if (/^233\d{9}$/.test(d)) local = d.slice(3);
  else if (/^0\d{9}$/.test(d)) local = d.slice(1);
  else if (/^\d{9}$/.test(d)) local = d;
  return local ? `+233${local}` : null;
}
export const prettyPhone = (p) => (p ? `${p.slice(0, 4)} ${p.slice(4, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : '');
export const maskPhone = (p) => (p ? `${p.slice(0, 4)} ${p.slice(4, 6)} ··· ${p.slice(9)}` : '');

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
 * { name, phone?, area?, method: 'password'|'momo'|'wallet'|'guest', address?, walletName?, rdns?, role? }
 */
export const getSession = () => read(SESSION_KEY, null);
export function setSession(s) { write(SESSION_KEY, { ...s, at: Date.now() }); }
export function updateSession(patch) { const s = getSession(); if (s) setSession({ ...s, ...patch }); }
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const METHOD_LABEL = { password: 'Aegis account', momo: 'MoMo (simulated)', wallet: 'Browser wallet', guest: 'Guest' };
