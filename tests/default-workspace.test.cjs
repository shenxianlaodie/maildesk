'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8');
const helpers=source.slice(source.indexOf('function orderProgress('),source.indexOf('function order(){'));
test('orders display later fulfillment first, then payment, with newer ties first',()=>{
 const ctx=vm.createContext({});vm.runInContext(helpers,ctx);
 const orders=[{id:'unpaid',financial_status:'pending'},{id:'paid-old',financial_status:'paid',placed_at:'2026-01-01'},{id:'paid-new',financial_status:'paid',placed_at:'2026-02-01'},{id:'shipped',fulfillment_status:'shipped'},{id:'tracking',shipments:[{tracking_number:'A'}]},{id:'transit',tracking:[{status:'In transit',at:'2026-01-01'}]},{id:'delivered',tracking:[{status:'Delivered',at:'2026-01-01'}]},{id:'cancelled',order_status:'cancelled',financial_status:'paid'}];
 ctx.detail={orders,preferredOrderId:'unpaid'};assert.equal(vm.runInContext('prioritizeOrders(detail)',ctx),'delivered');assert.deepEqual(orders.map(o=>o.id),['delivered','transit','tracking','shipped','paid-new','paid-old','unpaid','cancelled']);
 ctx.detail={orders:[{id:'unpaid'}],orderCandidates:[{id:'other'}]};assert.equal(vm.runInContext('prioritizeOrders(detail)',ctx),'');
 ctx.detail={orders:[]};assert.equal(vm.runInContext('prioritizeOrders(detail)',ctx),'');
});
test('initial load renders list without opening or marking any conversation',async()=>{
 const start=source.indexOf('async function init(){'),end=source.indexOf('const replySignatures=',start);let opened=0,rendered=0;const state={};
 const ctx=vm.createContext({state,appBase:'',fetch:async()=>({json:async()=>({token:'t'})}),refreshMeta:async()=>{},api:async()=>({rows:[{id:'customer'}]}),skeleton(){},setMobile(){},renderList(){rendered++;},selectCustomer(){opened++;}});
 vm.runInContext(source.slice(start,end),ctx);await vm.runInContext('init()',ctx);assert.equal(rendered,1);assert.equal(opened,0);assert.equal(state.id,undefined);
});
