# Aegis-Grid web (landing page + live console)

Three pages, built with [Vite](https://vite.dev) and plain JavaScript (same style as `bridge/`):

| Page | File | What it shows |
|---|---|---|
| Landing | `index.html` | The 3D "one day in Accra" story (three.js). The closing section reads live totals from the escrow contract. |
| Sign up / log in | `auth.html` | Create an account (a wallet is made for the user), log in with phone + password, MoMo (simulated), MetaMask or Coinbase Wallet, then choose buyer or seller. |
| Console | `console.html` | Buyer (the shop, Household B), seller (the battery owner, Household A) and operator views, fed by live meter data and the contract. Works on phones (bottom tab bar). |

The landing story is a narrative: its numbers are illustrative. The console shows **real** data only: meter telemetry from MQTT and trades, payouts and balances from the `AegisEscrow` contract.

## Run it

```bash
cd web
npm install
cp .env.example .env        # public values only, see below
npm run dev                 # http://localhost:5173  (console: /console.html)
```

For live data, also run the meters and the bridge (from the repository root, same `SITE` everywhere):

```bash
# terminal 1: mock meters (or the two Wokwi meters)
cd tools/sim && SITE=ag-demo npm run meters
# terminal 2: bridge (needs the root .env, see docs/dev-setup.md)
cd bridge && npm start
```

Production build: `npm run build` writes static files to `web/dist/` (deploy to Vercel, Netlify or GitHub Pages).

## Settings (`web/.env`)

Everything in this file is bundled into the browser. **Never put a private key here.** The defaults point at the deployed Base Sepolia contract and the demo accounts from `docs/evidence.md`.

| Variable | Meaning |
|---|---|
| `VITE_SITE` | Same `SITE` as firmware, mock meters and bridge |
| `VITE_MQTT_WS_URL` | MQTT over WebSocket. Public broker: `wss://broker.hivemq.com:8884/mqtt`. Local broker: `ws://localhost:8080` |
| `VITE_RPC_URL`, `VITE_CHAIN_ID` | Base Sepolia RPC and chain id 84532 |
| `VITE_ESCROW_ADDRESS`, `VITE_DEPLOY_BLOCK` | Contract and the block it was deployed in (history starts there) |
| `VITE_EXPLORER_URL` | Blockscout, used for links and for loading the event history in one request |
| `VITE_SELLER_ADDRESS`, `VITE_BUYER_ADDRESS`, `VITE_UTILITY_ADDRESS`, `VITE_PLATFORM_ADDRESS` | Demo accounts shown as Seller A, Buyer B, utility and platform |
| `VITE_DIESEL_L_PER_KWH`, `VITE_CO2_KG_PER_L` | Impact factors. **Assumptions** until the team cites sources (README "Impact method") |

Browsers cannot open raw MQTT on port 1883, so the console uses WebSocket. `tools/sim/local-broker.js` now also listens on `ws://localhost:8080` for fully offline work.

## How the console maps to the backend

> **v2 (Wokwi Stage 4E + Unity):** topics now start with `aegis-grid/<SITE>/` (default site `ag-sakarya26`). **Request clean power / Stop and pay** publish `{ "requesting": true/false }` to `app/request`; the demo controls publish to `app/demo`; the console also reads the relayer status on `backend/status`. Start the backend with `cd bridge && npm run v2` (or `npm run v2:mock` without Wokwi). Details: [docs/integration-v2.md](../docs/integration-v2.md). The table below describes v1.

| Console | Backend |
|---|---|
| Grid status, battery %, solar, curtailed, export/import watts | `aegisgrid/<SITE>/grid` and `meter/METER_A|METER_B/telemetry` |
| **Request clean power** / **Stop and pay** | publishes `{ "requesting": true/false }` to `aegisgrid/<SITE>/sim/control` (mock meters). The bridge sees the buyer's `requesting` and calls `openTrade` / stops the meters and calls `settleTrade` |
| Demo control (outage, daylight, tamper, shop load) | `sim/control` fields `outage`, `pvW`, `tamper`, `shopLoadW` |
| Live session, trade number, open transaction | `TradeOpened` event + buyer telemetry `tradeId`, `tradeWh` |
| Receipt, split, refund | `TradeSettled` (`sellerShare`, `utilityShare`, `platformShare`, `buyerRefund`); readings from `trade/<id>/reading/<role>` (retained) |
| Disputes | `TradeDisputed(sellerWh, buyerWh)`; the owner can **Resolve** (`resolveDispute`) from the operator view |
| Balances, **Withdraw** | `withdrawable(address)`, `withdraw()` from the connected wallet |
| Start selling (onboarding) | `registerMeter(meter)` from the connected wallet |
| Totals, fees, tolerance | `totalDeliveredWh`, `nextTradeId`, `utilityBps`, `platformBps`, `toleranceBps`, `owner`, `paused` |

Wallet actions use MetaMask (or any injected wallet) on Base Sepolia; the console asks the wallet to switch network. Use testnet accounts only.

**Wokwi:** the Wokwi meters do not listen to `sim/control`. With Wokwi, use the outage switch and the request button inside the simulation; the console still shows everything live.

Amounts on-chain are in gwei/ETH because the contract settles in test ETH.

## Sign up and log in (`auth.html`)

The console opens only for a signed-in person; anyone else lands on the log in page. `console.html?guest` (the landing page's "Try the demo") opens it without an account.

| Way in | What happens |
|---|---|
| **Create account** (name, MoMo number, neighbourhood, password) | A new wallet is created in the browser and stored **encrypted with the password** (Ethereum keystore, scrypt). The password is never stored: logging in works by decrypting the wallet. If the number already has an account, the page sends the person to log in. |
| **Log in** (phone + password) | Unlocks that wallet. |
| **Connect a wallet → MoMo** *(simulated)* | Phone number, a one-time code shown as a simulated SMS, then name and neighbourhood for a new number. Aegis creates the wallet for that number. |
| **Connect a wallet → MetaMask / Coinbase Wallet** | Real browser wallets, told apart with EIP-6963. The console then signs transactions with the chosen wallet. The demo buyer and seller addresses are recognised. |

After signing in, the person picks **I need power** (buyer view) or **I have a battery to share** (seller view) and can switch any time. The account menu (top right) shows the Aegis wallet and **Log out**.

Prototype limits: accounts live in this browser's storage only (no server), a forgotten password cannot be reset, and the MoMo wallet is shown by address only. Production path: a backend or embedded-wallet service creates and protects the wallets, and MoMo sign in checks the number with the MTN MoMo API before sending a real code.

## Mobile money (simulated)

The console shows the planned **MoMo** payment layer, clearly labelled *Simulated MoMo*. No payment API is called and no real money moves.

| Step | What the user sees | What really happens |
|---|---|---|
| The buyer requests power | Deposit quote in USD, "Pay with MoMo", a phone approval screen, then "Confirming payment" | Nothing is charged. After "Approve", the console sends `requesting: true` and the bridge opens a real trade |
| Live session | Cost so far in USD (and gwei) | Real meter telemetry |
| Trade settles | Receipt: deposit, refund of the unused part to the buyer's MoMo | Real `TradeSettled` event; USD values are derived from it |
| Seller | "Paid to your MoMo" per trade | Derived from the seller share in `TradeSettled` |
| Dispute | Deposit "Held" | Real `TradeDisputed`, funds frozen in escrow |
| Operator | Mobile money ledger: collected, paid out, refunded, held | All derived from on-chain trades |

USD amounts use a fixed demo rate (`VITE_USD_PER_KWH`, default $0.20 per kWh), not a tariff or market price. On-chain balances and the Withdraw buttons appear when a wallet is connected.

Production path (roadmap): a small server calls the MTN MoMo Open API, Collections (`requestToPay`) for the deposit and Disbursements (`transfer`) for payouts and refunds, with the platform funding the escrow from its float. Going live needs an MTN merchant account and the applicable payment regulations in Ghana.

## Files

```
web/
  index.html, auth.html,
  console.html                    the three pages
  src/auth/                       sign up, log in, role choice
  src/lib/session.js              accounts (encrypted wallet) and the signed-in session
  src/lib/wallets.js              MetaMask / Coinbase Wallet discovery (EIP-6963)
  src/lib/config.js               settings and MQTT topic names (mirror bridge/src/config.js)
  src/lib/abi.js                  AegisEscrow ABI used by the browser (update if the contract changes)
  src/lib/mqtt.js                 live telemetry, readings, sim/control
  src/lib/chain.js                contract reads, event history, wallet transactions
  src/lib/store.js                shared state for the UI
  src/landing/                    3D scene (three.js 0.128, pinned: newer versions change lighting and colours)
  src/console/                    console UI and styles
```

## Tested

End to end on a local chain (anvil) with the real contract, the real bridge and the mock meters: an honest trade settled (81 Wh sent, 80 Wh received, 1.2% gap, split 83/15/2), a tampered trade was disputed (74 vs 43 Wh), the owner resolved it from the console, and seller and buyer withdrew from the console. Not yet run against the public broker and Base Sepolia from a browser.

To repeat it locally: start `anvil`, deploy with `forge create`, register both meters with `cast send … registerMeter`, run `npm run broker`, the mock meters and the bridge with `MQTT_URL=mqtt://localhost:1883` and the anvil RPC in the root `.env`, then set `VITE_RPC_URL=http://127.0.0.1:8545`, `VITE_CHAIN_ID=31337`, `VITE_DEPLOY_BLOCK=0` and `VITE_MQTT_WS_URL=ws://localhost:8080` in `web/.env.local`.
