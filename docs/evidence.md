# On-chain evidence (Base Sepolia testnet)

Everything below can be checked by anyone on the public explorer. Meter readings in these trades came from the **mock meters** in `tools/sim` (simulated data, same message format as the Wokwi meters). The contract, signatures, transactions and payments are real testnet transactions.

## Contract

| Item | Value |
|---|---|
| Network | Base Sepolia (chain id 84532) |
| Contract | `AegisEscrow` at [`0x918ad58816c6d09137eB4075c2BA5c3e56aC4f6a`](https://base-sepolia.blockscout.com/address/0x918ad58816c6d09137eB4075c2BA5c3e56aC4f6a) |
| Source code | Verified on Blockscout (tab "Contract") |
| Deployment | [tx `0xcba5ff4e…35af`](https://base-sepolia.blockscout.com/tx/0xcba5ff4eb5f6959494b4b63cd64ffc1b6a04002db97d3319b9bf6011704935af), block 48200239 |
| Compiler | solc 0.8.28, optimizer on (200 runs), OpenZeppelin 5.4.0 |
| Tests | 25 Foundry tests passing (`cd contracts && forge test`) |

## Demo accounts (testnet only)

| Role | Address |
|---|---|
| Deployer, contract owner (arbiter), bridge relayer, platform fee recipient | `0xdd33958c0f6a2f647Bcc1Fd989305D4824541D15` |
| Seller (battery owner, "Household A") | `0x66b9Cd34A3D306Eb89F0d7FcF528A101D22D6B49` |
| Buyer (shop, "Household B") | `0xA9Cbb353E5Cb00413f3CD6BfaB3d11121245610F` |
| Utility (grid fee recipient) | `0xC25b2acf83FaE9434Ecf09FF7C692b786906450F` |
| Seller meter signing key | `0x26eA7F67dD521794c1503b2Aef4f378BB0f09263` |
| Buyer meter signing key | `0xc37dE574E2C4fAd885d9D1D747f3458c94dCd4C7` |

Meter keys are software keys held by the bridge in this prototype. In production they would live in a hardware secure element inside each meter.

Meter registration: seller [tx `0x09a45cea…e919`](https://base-sepolia.blockscout.com/tx/0x09a45cea77adde7df3a72ec1206bb167077f40be1b4860205cf93ae3b9b0e919), buyer [tx `0x74f30b20…07b9`](https://base-sepolia.blockscout.com/tx/0x74f30b20d4eb004374b530de4b439800e1f742f4ac07b8d8a4d72087d4af07b9).

## Trades

Trade terms (design parameters): price 1 gwei per Wh, maximum 500 Wh per trade (deposit 500 gwei), duration 1 hour, tolerance 3%, utility fee 15%, platform fee 2%.

| Trade | Scenario | Seller meter | Buyer meter | Gap | Result | Open | Settle |
|---|---|---|---|---|---|---|---|
| 1 | Honest | 164 Wh | 161 Wh | 1.8% | **Settled**, paid for 161 Wh | [tx](https://base-sepolia.blockscout.com/tx/0x26f5d02b492a6c397178de9ce8cd8de3a115b8ae22615232aeb41ad89fd91771) | [tx](https://base-sepolia.blockscout.com/tx/0xcd27fe0705af0f9f97721a767c8a003391bdbcba30b47beb95de003da815f9b8) |
| 2 | Buyer meter tampered (reports 60%) | 138 Wh | 81 Wh | 41.3% | **Disputed**, funds frozen in escrow | [tx](https://base-sepolia.blockscout.com/tx/0x5ed399fac8c40430a4a315b6ee165f904209337a0c1363d4cdf484847222c032) | [tx](https://base-sepolia.blockscout.com/tx/0x267536e4e0336e02a75065b5c93ff2fb3c16f3cef4c17dfb4a142ab4e7f10ce5) |
| 3 | Honest (meter repaired) | 46 Wh | 45 Wh | 2.2% | **Settled**, paid for 45 Wh | [tx](https://base-sepolia.blockscout.com/tx/0xee6a623a566d46bcc8f4a0ca0374fe174d30a09191cb67d6e617a4815b7ae4a2) | [tx](https://base-sepolia.blockscout.com/tx/0x72ff8498bc458088bd87ee7b4f043680e55ac42383d5c3c886a2c02e095bcc76) |

On-chain counter `totalDeliveredWh` after these trades: **206 Wh** (161 + 45). The disputed trade added nothing.

### Settlement split, read from the `TradeSettled` events (wei)

| Trade | Paid amount | Seller (83%) | Utility (15%) | Platform (2%) | Refund to buyer |
|---|---|---|---|---|---|
| 1 | 161,000,000,000 | 133,630,000,000 | 24,150,000,000 | 3,220,000,000 | 339,000,000,000 |
| 3 | 45,000,000,000 | 37,350,000,000 | 6,750,000,000 | 900,000,000 | 455,000,000,000 |

The contract pays for the energy the **buyer's** meter received; cable loss is the seller's cost. Shares plus refund equal the 500 gwei deposit in both trades.

### The seller withdraws (pull payment)

Settlement only credits balances inside the contract; each party withdraws its own balance with `withdraw()`.

| Step | Value |
|---|---|
| Seller balance in the contract before | 170,980,000,000 wei (trade 1 + trade 3 shares) |
| `withdraw()` by the seller | [tx `0x88579b65…64cb`](https://base-sepolia.blockscout.com/tx/0x88579b659b29512f7a494cb4a2a554ef5b354abecc38a895132ab75aec3264cb), event `Withdrawn(seller, 170980000000)` |
| Seller balance in the contract after | 0 |
| Second `withdraw()` attempt | Reverted with `NothingToWithdraw` (no double payout) |
| Seller wallet balance afterwards | 99,567,025,999,785 wei = 100,000,000,000,000 funding − 409,464,000,111 (`registerMeter` fee) + 170,980,000,000 (earnings) − 194,490,000,104 (`withdraw` fee) |

With the deliberately tiny demo price (1 gwei per Wh) the earnings are about the size of one withdrawal fee. At real electricity prices the earnings dominate, and because balances accumulate across trades, a seller can withdraw rarely.

### Why the tampered trade is frozen, not refunded

If any mismatch refunded the buyer automatically, a buyer could tamper with its own meter to get energy for free. Freezing the deposit removes that incentive. The arbiter (the contract owner in this prototype) can call `resolveDispute`; if nobody does, the buyer can call `refundExpired` once the trade has expired and the 7-day dispute window has passed. A single-owner arbiter is a prototype simplification; production needs staking and slashing, a multisig or a decentralised oracle.

## Measured gas (Base Sepolia, 16 October 2026)

| Function | Gas used | Fee paid (wei) |
|---|---|---|
| Deploy `AegisEscrow` | 2,238,445 | 13,430,670,011,161 |
| `registerMeter` | 68,244 | 409,464,000,111 |
| `openTrade` (trade 1) | 195,373 | 1,172,238,000,172 |
| `settleTrade`, settled (trade 1) | 183,982 | 1,103,892,000,270 |
| `settleTrade`, settled (trade 3) | 98,494 | 590,964,000,290 |
| `settleTrade`, disputed (trade 2) | 57,716 | 346,296,000,292 |
| `withdraw` | 32,415 | 194,490,000,104 |

Fees are testnet amounts at a gas price of about 0.006 gwei, including the Layer-1 data fee. A dollar figure on mainnet depends on that day's gas price and ETH price, so we report gas units and testnet fees only. The second settlement uses less gas than the first because the recipients' balance slots were already non-zero.

## Stage 5B.3: live Wokwi trades on contract v2 (29 October 2026)

Faras's two ESP32 simulations in Wokwi (METER_A seller, METER_B buyer derived from METER_A) on his laptop, bridged to the public broker; the backend on Ola's laptop; contract v2 [`0x2736…fc6e`](https://base-sepolia.blockscout.com/address/0x273651238fe3e2279d2295edcbd005f31347fc6e). Every trade was opened on-chain from the dashboard, and the firmware received START/STOP with the escrow trade id. Final readings are unsigned simulated events; see `docs/integration-v2.md`, "Stage 5B.3".

| Trade | Mode | METER_A | METER_B | Check | Result |
|---|---|---|---|---|---|
| 2 | off | 10.278 Wh | 23.026 Wh | buyer > seller | **Rejected** before any settlement (METER_B counted with its own clock; fixed in the firmware) |
| 4 | off | 17.083 Wh | 16.742 Wh | 2.0% | **Simulation verified**, nothing sent on-chain |
| 5 | off | 4.028 Wh | 3.947 Wh | 2.0% | **Simulation verified** |
| 6 | testnet | 9.444 Wh | 9.256 Wh | 2.0%; whole Wh 9 / 9 | Both gateways signed (seller `0x26eA…9263`, buyer `0xc37d…D4C7`) → **Settled** on-chain, labelled `SIMULATED_TESTNET_SETTLEMENT` · [settle tx](https://base-sepolia.blockscout.com/tx/0xa354a8bfe7cec59ffd5460a00617f5c2ce25cba7ed5a1770de82af3a2d9a6404) |

Transparency: the contract verifies that each reading is signed by the meter key the seller's and the buyer's account registered. In this prototype those keys are held by two separate gateway processes that attest the Wokwi final of their own meter; METER_B is derived from METER_A, so the readings are not independent measurements. Trade 6 is a testnet demonstration with test funds, not evidence of a real energy delivery.

