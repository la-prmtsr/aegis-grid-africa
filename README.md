# Aegis-Grid Africa

**Powering Africa's Future: Zero Energy Waste, Zero Diesel Smoke.**
Tech Hub Africa Hackathon 2026, primary track: Electricity Efficiency.

Neighbourhood home batteries store midday solar surplus that would otherwise be curtailed, and sell it peer-to-peer to nearby shops during load shedding instead of diesel generators. Both smart meters report the energy, and an escrow contract pays only when the two readings agree.

> Work in progress. This README is the team's working copy and will be completed before submission.

## Repository layout

| Folder | What it is | Status |
|---|---|---|
| `firmware/meter-seller` | Wokwi ESP32 meter of the battery owner (METER_A) | v2 written, host-tested; to be run in Wokwi |
| `firmware/meter-buyer` | Wokwi ESP32 meter of the shop (METER_B) | v2 written, host-tested; to be run in Wokwi |
| `firmware/test` | Compiles both sketches on a PC with stubs and runs a full scenario | passing |
| `contracts` | `AegisEscrow` (Solidity, Foundry) with 25 tests incl. fuzz | passing, not yet on testnet |
| `tools/sim` | Mock meters, local MQTT broker, fake bridge (no blockchain) | working |
| `bridge` | MQTT to EIP-712 signing to `settleTrade` | next step |
| `web` | Next.js dashboard with 3D scene | next step |
| `docs/data-format.md` | **The agreement between all parts. Read this first.** | v1 |

## How it fits together

```
Wokwi METER_A ─┐                         ┌─► AegisEscrow (Base Sepolia)
               ├─ MQTT (topics in docs) ─► bridge ─┤
Wokwi METER_B ─┘   (or tools/sim mocks)  └─► dashboard (Next.js)
```

## Quick start

Prerequisites and step-by-step setup: [docs/dev-setup.md](docs/dev-setup.md).

```bash
git clone --recurse-submodules <repo-url> && cd aegis-grid-africa

# contracts
cd contracts && forge build && forge test && cd ..

# firmware logic on your PC (g++ needed)
./firmware/test/run.sh

# simulator: mock meters + fake bridge on the public broker
cd tools/sim && npm install
SITE=ag-yourteam npm run meters        # terminal 1 (keys: d o r t + - q)
SITE=ag-yourteam npm run fake-bridge   # terminal 2
```

## Real vs simulated

| Part | In this prototype |
|---|---|
| Smart meters | Simulated ESP32 in Wokwi; potentiometers stand in for sensors |
| Cable between homes | Simulated by an MQTT topic carrying cumulative energy |
| Meter signing keys | Software keys held by the bridge (a hardware secure element is the production design) |
| Settlement | Real smart contract on a public testnet (planned) |
| Mobile money payout, phone-number login | Not implemented; roadmap |
| Offline LoRa mesh | Design only; roadmap |

## Design parameters (not results)

20% minimum state of charge (firmware keeps 21% for rounding margin), 80% charge ceiling, 3% reading tolerance, 2% simulated line loss, 15% utility (grid) fee, 2% platform fee, time scale 60x in the simulation. Each will be justified in the final README.

## License

MIT
