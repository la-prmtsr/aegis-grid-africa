// Browser wallets. Uses EIP-6963 so MetaMask and Coinbase Wallet can be told apart when both are
// installed (otherwise they fight over window.ethereum). Falls back to window.ethereum.

const found = new Map(); // rdns -> { info, provider }

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const { info, provider } = e.detail || {};
    if (info?.rdns && provider) found.set(info.rdns, { info, provider });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export const KNOWN = {
  metamask: { rdns: 'io.metamask', name: 'MetaMask', install: 'https://metamask.io/download/' },
  coinbase: { rdns: 'com.coinbase.wallet', name: 'Coinbase Wallet', install: 'https://www.coinbase.com/wallet/downloads' },
};

/** Wallet announcements arrive asynchronously; give them a moment. */
export async function discover(ms = 300) {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((r) => setTimeout(r, ms));
  return [...found.values()];
}

/** The EIP-1193 provider for a wallet id (rdns), or a sensible default. */
export function providerFor(rdns) {
  if (rdns && found.has(rdns)) return found.get(rdns).provider;
  const eth = typeof window !== 'undefined' ? window.ethereum : null;
  if (!eth) return null;
  if (rdns === KNOWN.coinbase.rdns) {
    const list = eth.providers || [eth];
    return list.find((p) => p.isCoinbaseWallet) || null;
  }
  if (rdns === KNOWN.metamask.rdns) {
    const list = eth.providers || [eth];
    return list.find((p) => p.isMetaMask && !p.isCoinbaseWallet) || null;
  }
  return eth;
}

/** The icon a wallet announced for itself (EIP-6963 data URI), or null if it has not announced. */
export const iconFor = (rdns) => found.get(rdns)?.info?.icon || null;

export function isInstalled(rdns) {
  return !!providerFor(rdns);
}

/** Other wallets that announced themselves (Rabby, Brave, OKX...), excluding the two named ones. */
export const others = () => [...found.values()].filter((w) => w.info.rdns !== KNOWN.metamask.rdns && w.info.rdns !== KNOWN.coinbase.rdns);
