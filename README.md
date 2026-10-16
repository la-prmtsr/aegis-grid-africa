# Aegis-Grid Africa

> Powering Africa's Future: Zero Energy Waste, Zero Diesel Smoke.

Neighbourhood home batteries store midday solar energy that would otherwise be wasted, then sell it peer to peer to nearby shops during load shedding, instead of diesel generators. Both smart meters sign what they measured, and an escrow smart contract pays only when the two readings agree.

Built for the Tech Hub Africa Hackathon 2026. Track: **Electricity Efficiency**.

- **Contract (Base Sepolia, source verified):** [`0x918ad58816c6d09137eB4075c2BA5c3e56aC4f6a`](https://base-sepolia.blockscout.com/address/0x918ad58816c6d09137eB4075c2BA5c3e56aC4f6a)
- **On-chain evidence** (honest trade, tampered trade, payout): [docs/evidence.md](docs/evidence.md)
- Demo video: _TODO before submission_
- Live dashboard: _TODO before submission_
- Wokwi simulation: _TODO before submission_

## The problem

- **Wasted solar at midday.** Home and community solar systems often produce more than local batteries can absorb around noon, and the surplus is curtailed.
- **Load shedding at night.** Planned outages hit when demand peaks in the evening, which is when shops and homes need light and refrigeration most.
- **Diesel as the fallback.** During outages, small businesses run petrol or diesel generators, which are expensive to run and pollute the air and the street with fumes and noise.

## The solution

Aegis-Grid turns the batteries that households already own into a shared, neighbourhood-scale buffer:

1. **Onboarding.** Each household registers the signing key of its smart meter on the contract.
2. **Surplus charge (day).** Batteries charge from solar surplus up to an 80% health ceiling.
3. **Emergency P2P discharge (night).** During load shedding the street's microgrid is islanded from the utility grid. A shop presses *Request Clean Power*; a nearby battery owner's inverter supplies it, keeping its own battery above 20%.
4. **Dual-meter verification and settlement.** The seller's meter signs the energy it sent, the buyer's meter signs the energy it received. The escrow contract pays for what the buyer received if the two agree within 3%; otherwise it freezes the funds as *Disputed*.

Electrical safety note: exporting into utility lines during an outage is dangerous for line workers. The design therefore assumes a community microgrid with an islanding switch at its connection point, so P2P supply happens only inside the islanded microgrid.

## What is real vs simulated

| Component | Status in this prototype |
|---|---|
| Smart meters (ESP32) | **Simulated** in Wokwi; potentiometers stand in for sensors. A Node.js mock (`tools/sim`) speaks the same protocol |
| Cable between the two homes | **Simulated** by an MQTT topic carrying cumulative energy, with 2% line loss |
| Meter signing keys | Software keys held by the bridge. A hardware secure element is the production design |
| Dual-meter verification | **Real**: EIP-712 signatures checked on-chain by the contract |
| Escrow, fee split, disputes, payouts | **Real** smart contract on the Base Sepolia testnet (test ETH, no real money) |
| Phone-number login, mobile money payout | Not implemented; roadmap |
| Offline LoRa / ESP-NOW mesh | Design only; roadmap |

## Architecture

```mermaid
flowchart LR
  A[Meter A, seller<br/>Wokwi ESP32] -- telemetry, final reading --> M((MQTT broker))
  B[Meter B, buyer<br/>Wokwi ESP32] -- telemetry, final reading --> M
  A -- line: energy sent --> B
  M --> BR[Bridge<br/>Node.js]
  BR -- start / stop --> M
  BR -- openTrade, settleTrade<br/>EIP-712 signed readings --> C[AegisEscrow<br/>Base Sepolia]
  C -- events --> D[Dashboard]
  C -- withdraw --> P[Seller, utility, platform,<br/>buyer refund]
```

The message format between meters, bridge and dashboard is specified in [docs/data-format.md](docs/data-format.md).

## Tech stack

| Layer | Used |
|---|---|
| Smart contract | Solidity 0.8.28, OpenZeppelin Contracts 5.4.0, Foundry (forge, cast) |
| Network | Base Sepolia testnet (chain id 84532) |
| Bridge | Node.js 22, ethers 6, mqtt 5, dotenv |
| Meters | ESP32 on Wokwi, Arduino framework, PubSubClient, ArduinoJson 7 |
| Messaging | MQTT (public HiveMQ broker for the demo) |

## Repository structure

```
contracts/     AegisEscrow.sol, 25 Foundry tests, deploy script
bridge/        MQTT <-> contract bridge (listen.js, index.js, chain.js)
firmware/      Wokwi sketches for meter A (seller) and meter B (buyer), host test
tools/sim/     mock meters, local MQTT broker, model tests
docs/          data format, developer setup, on-chain evidence
```

## Getting started

Full setup, including Windows (WSL 2): [docs/dev-setup.md](docs/dev-setup.md).

```bash
git clone --recurse-submodules https://github.com/la-prmtsr/aegis-grid-africa.git
cd aegis-grid-africa
cp .env.example .env            # then fill in your own testnet values; never commit .env
```

**Run the tests**

```bash
cd contracts && forge test && cd ..          # 25 contract tests
./firmware/test/run.sh                       # meter firmware logic on the PC (needs g++)
cd tools/sim && npm install && npm test      # meter model tests
```

**Run the full flow** (two terminals, after deploying the contract and setting `.env`):

```bash
# terminal 1: mock meters (or the Wokwi meters with the same SITE)
set -a; source .env; set +a
cd tools/sim && npm run meters        # keys: d day/night, o outage, r request, t tamper, q quit

# terminal 2: bridge
cd bridge && npm install && npm start
```

Press `d`, `o`, `r`, wait, then `r` again: the bridge opens a trade, the meters exchange energy, and the trade settles on-chain. Press `t` first to see a tampered meter produce a dispute.

## Smart contract

`contracts/src/AegisEscrow.sol` ([tests](contracts/test/AegisEscrow.t.sol))

| Function | Who calls it | What it does |
|---|---|---|
| `registerMeter(meter)` | each household | Registers the address of the key that signs its meter readings |
| `openTrade(seller, pricePerWh, maxWh, duration)` | buyer | Escrows `maxWh × pricePerWh` |
| `settleTrade(id, sellerReading, sig, buyerReading, sig)` | anyone (the bridge) | Verifies both EIP-712 signatures; settles if readings agree within tolerance, otherwise marks the trade *Disputed* |
| `withdraw()` | anyone with a balance | Pull payment of credited funds |
| `resolveDispute(id, acceptedWh)` | owner (arbiter) | Settles a disputed trade |
| `refundExpired(id)` | anyone | Returns the deposit of an expired trade, or of a dispute after the 7-day window |

Security notes: signatures are bound to the chain and contract (EIP-712 domain) and to the trade id, so they cannot be replayed; settlement pays for the energy the buyer received; parameters are snapshotted per trade; reentrancy guard plus checks-effects-interactions on `withdraw`; pausing never traps funds. **Tested, not audited.** The single-owner arbiter is a prototype simplification.

## Impact method

The dashboard will convert the on-chain counter `totalDeliveredWh` into litres of diesel avoided and CO2 not emitted:

```
diesel avoided (L) = delivered energy (kWh) × generator fuel use (L per kWh)
CO2 avoided (kg)   = diesel avoided (L) × emission factor (kg CO2 per L)
```

_TODO before submission: choose and cite the generator fuel-use figure and the diesel emission factor._ All energy figures in the demo come from simulated meters.

## Design parameters

These are choices, not measured results.

| Parameter | Value | Reasoning |
|---|---|---|
| Minimum battery state of charge | 20% (firmware keeps 21%) | Protects battery life and leaves the owner a reserve; 1 point margin avoids rounding below the contract's floor |
| Charge ceiling | 80% | Battery health window |
| Reading tolerance | 3% | Covers normal cable loss between neighbours; larger gaps indicate a fault or tampering |
| Simulated line loss | 2% | Inside the tolerance, so honest trades settle |
| Fee split | 15% utility (grid fee), 2% platform, rest to seller | Illustrative; the utility is paid for its infrastructure |
| Demo price | 1 gwei per Wh | Kept tiny so the demo runs on faucet test ETH |
| Simulation speed | 60× (1 s = 1 simulated minute) | Makes a trade visible within a short video |

## Measured cost

From real Base Sepolia transactions (details in [docs/evidence.md](docs/evidence.md)): `openTrade` 195,373 gas, `settleTrade` 98,494 to 183,982 gas when it settles and 57,716 when it freezes a dispute, `withdraw` 32,415 gas. We report gas units; a dollar cost depends on mainnet gas and ETH prices on the day.

## Limitations and roadmap

- Meters, the cable and the offline mesh are simulated; real meters need certified hardware and a secure element.
- P2P supply requires certified inverters, an islanding switch and licensed installers, and must follow local electricity regulation.
- The arbiter is one account; next: staking and slashing or a decentralised oracle.
- Settlement uses test ETH; next: a stablecoin and mobile money payout, phone-number login.
- Next steps: a pilot in one market or street, a partnership with the utility as a demand-response programme.

## License

MIT
