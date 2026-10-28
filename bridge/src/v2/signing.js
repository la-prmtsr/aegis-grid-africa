// EIP-712 readings: each meter signs its own final reading; the relayer only verifies.
// Types must match the Solidity structs in contracts/src/AegisEscrow.sol exactly.
import { ethers } from 'ethers';

export const SELLER_TYPES = {
  SellerReading: [
    { name: 'tradeId', type: 'uint256' },
    { name: 'meter', type: 'address' },
    { name: 'wh', type: 'uint64' },
    { name: 'socBpsAfter', type: 'uint16' },
    { name: 'timestamp', type: 'uint64' },
  ],
};
export const BUYER_TYPES = {
  BuyerReading: [
    { name: 'tradeId', type: 'uint256' },
    { name: 'meter', type: 'address' },
    { name: 'wh', type: 'uint64' },
    { name: 'timestamp', type: 'uint64' },
  ],
};

export const domainFor = (chainId, escrow) => ({ name: 'AegisGrid', version: '1', chainId: BigInt(chainId), verifyingContract: escrow });

/** The struct exactly as the contract receives it. */
export function structOf(reading) {
  const base = { tradeId: BigInt(reading.tradeId), meter: reading.meter, wh: BigInt(reading.wh) };
  return reading.role === 'seller'
    ? { ...base, socBpsAfter: Number(reading.socBpsAfter), timestamp: BigInt(reading.timestamp) }
    : { ...base, timestamp: BigInt(reading.timestamp) };
}

const typesOf = (role) => (role === 'seller' ? SELLER_TYPES : BUYER_TYPES);

/**
 * Sign a final reading with the meter's own key. `timestamp` should come from the chain
 * (latest block time minus a margin) so the contract never sees a future time.
 */
export async function signReading(wallet, domain, final, timestamp) {
  const reading = { ...final, meter: wallet.address, timestamp: Number(timestamp) };
  const signature = await wallet.signTypedData(domain, typesOf(final.role), structOf(reading));
  return { ...reading, signature, chainId: Number(domain.chainId), escrow: domain.verifyingContract };
}

/** Address that signed the reading, or null if the signature is malformed. */
export function recoverSigner(domain, reading) {
  try {
    return ethers.verifyTypedData(domain, typesOf(reading.role), structOf(reading), reading.signature);
  } catch {
    return null;
  }
}

/** Chain time minus a margin, for reading timestamps. */
export async function chainTimestamp(provider, marginS = 5) {
  const block = await provider.getBlock('latest');
  return block.timestamp - marginS;
}
