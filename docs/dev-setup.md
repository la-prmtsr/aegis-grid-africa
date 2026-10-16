# Developer setup

One repository, three people, no waiting on each other: every part can run against the mock meters in `tools/sim`.

## Tools (install once)

| Tool | Version | Used for | Check |
|---|---|---|---|
| Git | any recent | repository, submodules | `git --version` |
| VS Code | latest | editor | |
| Node.js | 20 LTS or 22 LTS | simulator, bridge, dashboard | `node -v` |
| Foundry | stable | contracts: build, test, deploy | `forge --version` |
| g++ (C++17) | any | firmware host test (optional) | `g++ --version` |
| MetaMask | browser extension | testnet wallet for deploy and demo | |

VS Code extensions: *Solidity* (Juan Blanco or Nomic Foundation), *ESLint*, *Tailwind CSS IntelliSense*, *Wokwi Simulator* (optional, runs Wokwi inside VS Code).

### Windows

Foundry and the shell scripts need a Unix shell. Use **WSL 2 (Ubuntu)**:

```powershell
wsl --install -d Ubuntu      # in PowerShell as administrator, then restart
```

Then do everything below inside the Ubuntu terminal, and open the folder with `code .` from there (VS Code "WSL" extension). Keep the repository inside the Linux file system (for example `~/aegis-grid-africa`), not under `/mnt/c/...`, which is slow.

### Inside Ubuntu (WSL) or on macOS / Linux

```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22

# Foundry
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup

# compiler for the firmware host test (Ubuntu)
sudo apt update && sudo apt install -y build-essential
```

## First time only: one person creates the GitHub repository

Starting from the starter zip (which has no `.git` and no `contracts/lib`):

```bash
unzip aegis-grid-africa-starter.zip && cd aegis-grid-africa
git init -b main
git add . && git commit -m "Starter monorepo"
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.4.0   # adds them as submodules
forge test                                                                       # expect 25 passed
cd ..
git add . && git commit -m "Add Foundry dependencies"
# create an empty public repo on github.com (no README), then:
git remote add origin https://github.com/<user>/aegis-grid-africa.git
git push -u origin main
```

Add the other two members as collaborators (repo Settings > Collaborators).

## Get the code (everyone else)

```bash
git clone --recurse-submodules <repo-url>
cd aegis-grid-africa
# if you cloned without --recurse-submodules:
git submodule update --init --recursive
cp .env.example .env    # fill in later; never commit .env
```

## Who runs what

| Person | Folder | Everyday commands |
|---|---|---|
| Hardware / Wokwi | `firmware/` | edit in wokwi.com, copy back to the repo; `./firmware/test/run.sh` |
| Contract + bridge | `contracts/`, `bridge/` | `forge test -vv`; `npm run meters` + bridge |
| Dashboard + 3D + pitch | `web/` | `npm run meters` + `npm run dev` |

## Running the simulator

```bash
cd tools/sim && npm install

# public broker (Wokwi can reach it). Pick a team-unique SITE and use it everywhere.
SITE=ag-yourteam npm run meters
SITE=ag-yourteam npm run fake-bridge

# fully offline (Wokwi cannot reach this one)
npm run broker                                            # terminal 1
MQTT_URL=mqtt://localhost:1883 npm run meters             # terminal 2
MQTT_URL=mqtt://localhost:1883 npm run fake-bridge        # terminal 3
```

Mixing is allowed: Wokwi seller + mock buyer (`npm run meters -- --only buyer`) or the reverse.

To watch raw messages: [MQTT Explorer](https://mqtt-explorer.com/) connected to `broker.hivemq.com:1883`, topic `aegisgrid/<SITE>/#`.

## Running the meters in Wokwi

1. On wokwi.com create two ESP32 projects: *Aegis Meter A (seller)* and *Aegis Meter B (buyer)*.
2. For each, paste `sketch.ino`, `diagram.json` and `libraries.txt`, and add the model header as a new file (`seller_model.h` or `buyer_model.h`, use the "+" next to the file tabs).
3. Set `#define SITE` to your team id in both sketches.
4. Run both in **separate browser windows side by side** (background tabs are throttled by the browser and slow the simulation).
5. If a slide switch works the wrong way round, move its ground wire from pin 3 to pin 1 in `diagram.json`.

## Contracts

```bash
cd contracts
forge build
forge test -vv
forge test --gas-report
```

Deployment to Base Sepolia: follow the steps in the escrow skill notes (throw-away wallet, faucet early, keystore account), then record the address and transaction hashes in the README.
