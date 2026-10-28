import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTelemetry,allocate,DemoTradeMeter,settlementGate} from '../src/aegis-unity/core.mjs';
const raw = {site:'ag-sakarya26',meter_id:'METER_A',pv_power_w:900,pv_delivered_to_microgrid_w:0,
 local_load_w:300,buyer_demand_w:250,buyer_request:true,total_demand_w:550,
 battery_discharge_w:250,battery_charge_w:0,grid_import_w:0,unserved_power_w:300,
 grid_status:'OUTAGE',battery_soc_pct:49,emergency_backup_allowed:false};
test('buyer-first outage',()=> {const t=normalizeTelemetry(raw); const a=allocate(t);assert.equal(a.buyerSuppliedW,250);assert.equal(a.communitySuppliedW,0);});
test('opt-in emergency',()=>{const t=normalizeTelemetry({...raw,emergency_backup_allowed:true,battery_discharge_w:500,unserved_power_w:50}); const a=allocate(t);assert.equal(a.buyerSuppliedW,250);assert.equal(a.communitySuppliedW,250);});
test('isolation violation rejected',()=>assert.throws(()=>normalizeTelemetry({...raw,pv_delivered_to_microgrid_w:900}))); 
test('reserve violation rejected',()=>assert.throws(()=>normalizeTelemetry({...raw,battery_soc_pct:4.9}))); 
test('loss estimate not a buyer signature',()=>{const m=new DemoTradeMeter();m.add({sellerExportW:250,timestampMs:0});let r=m.add({sellerExportW:250,timestampMs:3600});assert.ok(Math.abs(r.sellerSentWh-.25)<1e-9);assert.ok(Math.abs(r.buyerReceivedWhEstimated-.245)<1e-9);assert.equal(r.settlementEligible,false);});
test('no settlement using synthetic buyer reading',()=>assert.equal(settlementGate({sellerFinal:{wh:10,socBpsAfter:500,signed:true},buyerFinal:{wh:9,signed:true,independentlyMeasured:false},approvedSeller:true,approvedBuyer:true}).ok,false));
