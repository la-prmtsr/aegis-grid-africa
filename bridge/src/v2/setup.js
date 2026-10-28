// One-time setup after deploying the v2 contract: tops up the seller and buyer wallets for gas from the
// deployer and registers both meters on the v2 escrow. Safe to run twice (skips what is already done).
//   npm run v2:setup
import { ethers } from 'ethers';
import { chain, TRADE } from './config.js';
import { ABI } from './chain.js';

const provider = new ethers.JsonRpcProvider(chain.rpcUrl, undefined, { cacheTimeout: -1 });
const { chainId } = await provider.getNetwork();
const deployer = new ethers.Wallet(chain.relayerKey, provider);
const seller = new ethers.Wallet(process.env.SELLER_PRIVATE_KEY, provider);
const buyer = new ethers.Wallet(chain.buyerKey, provider);
const escrow = new ethers.Contract(chain.escrow, [...ABI, 'function registerMeter(address meter)'], provider);
const sellerMeter = new ethers.Wallet(chain.sellerMeterKey).address;
const buyerMeter = new ethers.Wallet(chain.buyerMeterKey).address;

console.log(`chain ${chainId}, escrow v2 ${chain.escrow}`);
const code = await provider.getCode(chain.escrow);
if (code === '0x') throw new Error('ESCROW_V2_ADDRESS has no contract on this chain. Deploy it first (docs/integration-v2.md).');
const minSoc = Number(await escrow.MIN_SOC_BPS());
console.log(`contract battery reserve: ${minSoc / 100}%`);

// gas for registerMeter (seller) and for deposits + gas (buyer)
const deposit = TRADE.maxWh * TRADE.pricePerWh;
// sized from the current gas price: registerMeter for the seller, 20 trades (deposit + gas) for the buyer
const fee = await provider.getFeeData();
const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
const want = { seller: gasPrice * 300_000n, buyer: deposit * 20n + gasPrice * 250_000n * 20n };
console.log(`gas price ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
let nonce = await provider.getTransactionCount(deployer.address, 'pending'); // explicit: public RPC nodes can lag
for (const [name, w] of [['seller', seller], ['buyer', buyer]]) {
  const bal = await provider.getBalance(w.address);
  if (bal < want[name]) {
    const tx = await deployer.sendTransaction({ to: w.address, value: want[name] - bal, nonce: nonce++ });
    await tx.wait();
    console.log(`funded ${name} ${w.address} with ${ethers.formatEther(want[name] - bal)} ETH (tx ${tx.hash})`);
  } else {
    console.log(`${name} ${w.address} has ${ethers.formatEther(bal)} ETH, enough`);
  }
}

for (const [name, w, meter] of [['seller', seller, sellerMeter], ['buyer', buyer, buyerMeter]]) {
  const current = await escrow.meterOf(w.address);
  if (current.toLowerCase() === meter.toLowerCase()) {
    console.log(`${name} meter ${meter} already registered`);
    continue;
  }
  const tx = await escrow.connect(w).registerMeter(meter);
  await tx.wait();
  console.log(`registered ${name} meter ${meter} (tx ${tx.hash})`);
}
console.log('setup done');
