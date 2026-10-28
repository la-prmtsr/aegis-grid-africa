# Data format v1: meters, bridge and dashboard

> **Superseded for the live demo by [integration-v2.md](integration-v2.md)** (Faras's Wokwi Stage 4E + Unity). Kept because the v1 on-chain evidence in `evidence.md` was produced with this protocol and the `firmware/` and `tools/sim/` code.

This is the agreement between the three parts of the system. The Wokwi meters, the mock meters, the bridge and the dashboard all follow it, so each part can be built and tested on its own. **Change it only with the whole team, and bump `v`.**

All meter data is **simulated** (Wokwi or the mock script). Every message carries `"simulated": true`.

## Broker and topic prefix

| Item | Value |
|---|---|
| Broker (demo) | `broker.hivemq.com`, port 1883 (TCP, public, no login) |
| Broker (offline dev) | local broker from `tools/sim` (`npm run broker`), port 1883 |
| Topic prefix | `aegisgrid/<SITE>/` |
| `SITE` | a team-unique id, for example `ag-k7q2`. Set the same value in firmware, mock, bridge and dashboard. The public broker is shared with strangers. |

Security note: the public broker has no authentication, so anyone could publish to these topics. That is acceptable for a simulation because the contract only accepts readings signed by registered meter keys. Production would use TLS and per-device credentials.

## Topics

| Topic | Publisher | Subscribers | Retained | Rate |
|---|---|---|---|---|
| `grid` | seller meter (grid switch), dashboard | buyer meter, bridge, dashboard | yes | on change + every 10 s |
| `meter/<meterId>/telemetry` | each meter | bridge, dashboard | no | 1 Hz |
| `meter/<meterId>/cmd` | bridge | that meter | no | on event |
| `line/<lineId>` | seller meter | buyer meter | no | 4 Hz during a trade |
| `trade/<tradeId>/reading/<role>` | each meter | bridge, dashboard | yes | once per trade per role |

Meter ids for the demo: `METER_A` (seller, battery owner), `METER_B` (buyer, shop). Line id: `L1`.

## Units

- Power in watts (`W`), energy in watt-hours (`Wh`).
- **Final readings are integers** (`wh`, `socBpsAfter`), because the contract only takes integers. Telemetry may use decimals.
- State of charge in basis points: `5000` = 50.00%.
- `simMin` is simulated minutes since boot. The meters run `timeScale` times faster than real time (default 60: one real second is one simulated minute), so a demo trade takes about two minutes instead of two hours. Say this in the video.

## Messages

### `grid`

```json
{ "v": 1, "status": "OUTAGE", "source": "METER_A", "simulated": true }
```

`status` is `"OUTAGE"` (load shedding, microgrid islanded) or `"AVAILABLE"`.

### Seller telemetry: `meter/METER_A/telemetry`

```json
{
  "v": 1, "meterId": "METER_A", "role": "seller", "seq": 412, "simMin": 412.0, "timeScale": 60,
  "grid": "OUTAGE",
  "pvW": 0.0, "loadW": 120.0,
  "chargeW": 0.0, "curtailedW": 0.0,
  "dischargeLocalW": 120.0, "exportW": 250.0,
  "batteryWh": 702.4, "socBps": 7024,
  "tradeId": 7, "tradeWh": 133.3, "exportWhTotal": 1840,
  "status": "EXPORTING", "simulated": true
}
```

- `curtailedW`: solar surplus the battery could not absorb (would be wasted). This feeds the "zero energy waste" metric.
- `dischargeLocalW`: battery power used by the seller's own home during an outage (served first).
- `exportW`: power sent to the buyer over the line.
- `status`: `IDLE_GRID` | `CHARGING` | `BATTERY_FULL` (solar surplus is being curtailed) | `ISLAND` | `EXPORTING` | `WAIT_OUTAGE` (trade open but grid is up) | `SOC_FLOOR`.

### Buyer telemetry: `meter/METER_B/telemetry`

```json
{
  "v": 1, "meterId": "METER_B", "role": "buyer", "seq": 415, "simMin": 415.0, "timeScale": 60,
  "grid": "OUTAGE",
  "loadW": 300.0, "importW": 245.0, "unservedW": 55.0,
  "requesting": true, "tamper": false,
  "tradeId": 7, "tradeWh": 130.6, "importWhTotal": 1790,
  "status": "RECEIVING", "simulated": true
}
```

- `unservedW`: load not covered during an outage. Without Aegis this is what a diesel generator would supply.
- `requesting`: the shop pressed "Request Clean Power". The bridge opens a trade on the rising edge.
- `tamper`: demo switch. When on, the buyer meter under-reports by 40% to show the fraud case.
- `status`: `IDLE_GRID` | `REQUESTING` | `RECEIVING` | `NO_SUPPLY`.

### Commands: `meter/<meterId>/cmd` (bridge to meter)

```json
{ "cmd": "start", "tradeId": 7, "maxWh": 500, "targetW": 250 }
{ "cmd": "target", "tradeId": 7, "targetW": 300 }
{ "cmd": "stop", "tradeId": 7 }
```

`tradeId` is the id returned by `openTrade` on the contract. A meter ignores `target` and `stop` for a trade it is not running.

### Line: `line/L1` (seller to buyer)

```json
{ "tradeId": 7, "whSent": 133.27, "w": 250.0 }
```

This topic stands in for the physical copper cable. `whSent` is the cumulative energy injected for this trade. The buyer meter computes what arrives as `whSent * (1 - lineLoss)` (line loss 2%, a design parameter). Using cumulative energy rather than power keeps both meters consistent even if one Wokwi tab runs slower than the other.

### Final reading: `trade/<tradeId>/reading/<role>`

```json
{ "v": 1, "tradeId": 7, "role": "seller", "meterId": "METER_A", "wh": 312, "socBpsAfter": 4870, "reason": "stop_cmd", "simulated": true }
{ "v": 1, "tradeId": 7, "role": "buyer",  "meterId": "METER_B", "wh": 305, "tamper": false, "reason": "stop_cmd", "simulated": true }
```

- Published once per trade per role, retained, so a restarted bridge still sees it.
- `wh` is rounded down to an integer. `socBpsAfter` is the seller's state of charge after the trade.
- `reason`: `stop_cmd` | `max_reached` | `soc_floor`.
- The seller meter keeps its battery at or above 21% (one point of margin above the contract's 20% floor), so `socBpsAfter` never fails the contract's depth-of-discharge check because of rounding.

## Trade lifecycle

1. Grid switch goes to `OUTAGE`. The seller meter publishes `grid`.
2. The shop presses **Request Clean Power**. Buyer telemetry shows `requesting: true`.
3. The bridge calls `openTrade(seller, pricePerWh, maxWh, duration)` as the buyer (in the demo the bridge holds the buyer's testnet key: a simulated custodial wallet), reads the new `tradeId`, and sends `start` to both meters.
4. The seller exports `min(targetW, battery limit)` and publishes `line/L1`; the buyer counts what arrives.
5. The trade ends when the shop stops requesting, when `maxWh` is reached, or when the seller hits the SoC floor. **Order matters:** the bridge sends `stop` to the seller first (or the seller stops itself), the seller publishes a last `line` message and then its final reading, and only after receiving that final reading does the bridge send `stop` to the buyer, which then publishes its own final reading. This way both meters close on the same cumulative energy.
6. The bridge signs both readings with EIP-712 (meter keys held by the bridge in the simulation) and calls `settleTrade`. Matching readings settle; a mismatch beyond 3% freezes the trade as `Disputed`.
7. If either final `wh` is 0, the bridge does not submit (the contract would revert); the buyer's deposit is returned by `refundExpired` after the trade expires.

## Mapping to the contract

| Message field | Contract field |
|---|---|
| seller final `wh` | `SellerReading.wh` |
| seller final `socBpsAfter` | `SellerReading.socBpsAfter` |
| buyer final `wh` | `BuyerReading.wh` |
| `tradeId` | `tradeId` (both readings) |
| bridge clock (Unix seconds, slightly in the past) | `timestamp` |
| meter key held by the bridge | `meter` (must equal the registered meter address) |
