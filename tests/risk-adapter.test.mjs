import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const core=fs.readFileSync(new URL('../desktop/plugin.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../standalone/design/risk-gm-b.js',import.meta.url),'utf8');
function adapter(item,today='2026-12-05',local=null){
 const context=vm.createContext({window:{},performance:{now:()=>0}});
 vm.runInContext(core.slice(core.indexOf('const SAMPLE ='),core.indexOf('const pageStyle =')).replaceAll('export ',''),context);
 vm.runInContext(`const data={as_of:'2026-10-31',months:['2026-08','2026-09','2026-10']},currentToday=${JSON.stringify(today)},settings={months_of_cover:2}; const localOrderFor=()=>(${JSON.stringify(local)});`,context);
 vm.runInContext(source.slice(0,source.indexOf('function productRisk(')),context);
 return JSON.parse(vm.runInContext(`JSON.stringify(riskSpec({item:${JSON.stringify({sku:'ADAPTER',unit:'units',on_hand:20,monthly_sales:[30,30,30],projection:[{demand:30}],...item})},guidance:{status:'order',quantity:100,lead_days:14,order_by:'now'}}))`,context));
}
test('undated incoming and dated monthly receipts remain separate additive supply',()=>{
 const s=adapter({on_order:100,receipts:{'2026-10':999,'2026-11':100,'2026-12':100}});
 assert.equal(s.on_order,0);assert.equal(s.today,'2026-11-01');assert.equal(s.order_by,'2026-12-05');
 assert.deepEqual(s.receipts,[{date:'2026-11-01',quantity:100},{date:'2026-12-01',quantity:100},{date:'2026-12-19',quantity:100}]);
});
test('device local receipt is included once with original confirmed date',()=>{
 const local={sku:'ADAPTER',unit:'units',qty:40,expected_on:'2026-12-20'};
 const facts={version:'1.0',warehouses:['Local device'],incoming_pos:[{po_line_id:'local-device:ADAPTER',sku:'ADAPTER',warehouse:'Local device',supplier:'Supplier',remaining_qty:40,due_date:'2026-12-20',status:'confirmed'}]};
 const direct=adapter({planning_facts:facts},'2026-12-05',local);
 assert.deepEqual(direct.receipts,[{date:'2026-12-20',quantity:40}]);
 const raw=adapter({},'2026-12-05',local);assert.deepEqual(raw.receipts,direct.receipts);
});
test('draft supplier POs are not promoted into confirmed supply',()=>{
 const facts={version:'1.0',warehouses:['W'],incoming_pos:[{po_line_id:'DRAFT',sku:'ADAPTER',warehouse:'W',supplier:'S',remaining_qty:40,due_date:'2026-12-20',status:'draft'}]};
 assert.deepEqual(adapter({planning_facts:facts}).receipts,[]);
});
