'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {mailOrderRefresh}=require('../backend/mail-order-refresh.cjs');
const {refreshSlot,enqueueRefresh,refreshStatus}=require('../backend/order-refresh-schedule.cjs');
const {deskRoute}=require('../backend/desk.cjs');
function fixture(){
 const store=new Store(':memory:');store.addStaff({id:'local-operator',name:'Test'});store.addInbox({id:'inbox',address:'support@example.com'});
 store.db.exec('CREATE TABLE external_order_links(customer_id TEXT,order_id TEXT,message_id TEXT,PRIMARY KEY(customer_id,order_id))');
 const add=email=>{const saved=store.upsertMessage({inboxId:'inbox',providerId:email,direction:'inbound',customerEmail:email,fromAddress:email,sentAt:'2026-10-22T00:00:00Z',subject:'Help',bodyText:'Hello'});return store.db.prepare('SELECT * FROM messages WHERE id=?').get(saved.id);};
 const m=add('one@example.com'),calls=[],order={id:'pg:1',order_number:'A123456',provider_id:'12345-A123456',shop_id:'shop'};
 const orders={forCustomer:async()=>[order],matchIdentifiers:async()=>[],get:async()=>order,link:async()=>{},refresh:async o=>calls.push(o.id)};
 let now=Date.parse('2026-10-22T00:59:59Z');const clock=()=>now;
 const runner=mailOrderRefresh(store,orders,{clock});
 return{store,m,add,orders,calls,runner,clock,setTime:v=>{now=Date.parse(v);}};
}
test('daily Beijing slot changes only at 09:00',()=>{
 for(const [utc,slot] of [['2026-10-22T00:59:59Z','2026-10-21T09:00'],['2026-10-22T01:00:00Z','2026-10-22T09:00'],['2026-10-22T05:59:59Z','2026-10-22T09:00'],['2026-10-22T06:00:00Z','2026-10-22T09:00'],['2026-10-22T23:00:00Z','2026-10-22T09:00']])assert.equal(refreshSlot(Date.parse(utc)),slot);
});
test('new replies still associate but never fetch fresh order status',async()=>{const f=fixture();try{f.m.subject='Order A123456';f.orders.matchIdentifiers=async()=>[await f.orders.get()];const result=await f.runner.processMessage(f.m);assert.equal(result.lastError,null);assert.equal(f.store.db.prepare('SELECT count(*) n FROM message_order_matches').get().n,1);assert.deepEqual(f.calls,[]);f.runner.schedule();assert.equal(refreshStatus(f.store.db,f.m.customer_id).status,'idle');}finally{await f.runner.close();f.store.close();}});
test('daily slot queues once, survives restart and ignores 14:00',async()=>{const f=fixture();let restarted;try{
 f.setTime('2026-10-22T01:00:00Z');f.runner.schedule();assert.equal(refreshStatus(f.store.db,f.m.customer_id).status,'pending');await f.runner.refreshNext();assert.equal(f.calls.length,1);
 f.runner.schedule();assert.equal(refreshStatus(f.store.db,f.m.customer_id).status,'done');
 restarted=mailOrderRefresh(f.store,f.orders,{clock:f.clock});restarted.schedule();assert.equal(refreshStatus(f.store.db,f.m.customer_id).status,'done');
 f.setTime('2026-10-22T06:00:00Z');restarted.schedule();await restarted.refreshNext();assert.equal(f.calls.length,1);
 f.setTime('2026-10-23T01:00:00Z');restarted.schedule();await restarted.refreshNext();assert.equal(f.calls.length,2);
 }finally{await restarted?.close();await f.runner.close();f.store.close();}});
test('manual refresh works outside slots, coalesces clicks and takes priority',async()=>{const f=fixture();try{
 const second=f.add('two@example.com');enqueueRefresh(f.store.db,f.m.customer_id,{now:f.clock()});enqueueRefresh(f.store.db,second.customer_id,{manual:true,now:f.clock()});enqueueRefresh(f.store.db,second.customer_id,{manual:true,now:f.clock()});
 await f.runner.refreshNext();assert.equal(refreshStatus(f.store.db,second.customer_id).status,'done');assert.equal(refreshStatus(f.store.db,f.m.customer_id).status,'pending');assert.equal(f.calls.length,1);
 }finally{await f.runner.close();f.store.close();}});
test('one failed order does not hide successful updates or report full success',async()=>{const f=fixture();try{
 f.orders.forCustomer=async()=>[{id:'good'},{id:'bad'}];f.orders.refresh=async o=>{if(o.id==='bad')throw Error('ORDER_REFRESH_NO_TOKEN');};enqueueRefresh(f.store.db,f.m.customer_id,{manual:true});await f.runner.refreshNext();
 const status=refreshStatus(f.store.db,f.m.customer_id);assert.equal(status.status,'partial');assert.equal(status.refreshed,1);assert.equal(status.failed,1);assert.equal(status.last_error,'ORDER_REFRESH_NO_TOKEN');
 }finally{await f.runner.close();f.store.close();}});
test('manual API updates only selected associated order and rejects missing or unrelated order',async()=>{const f=fixture();try{
 f.orders.forCustomer=async()=>[{id:'pg:1'},{id:'pg:2'}];
 const args={url:new URL('http://localhost/api/desk/order-refresh'),method:'POST',input:{customerId:f.m.customer_id,orderId:'pg:2'},store:f.store,remoteOrders:f.orders,pilot:{actor:'local-operator'},demo:false};
 assert.equal((await deskRoute(args)).refreshed,1);assert.deepEqual(f.calls,['pg:2']);
 await assert.rejects(deskRoute({...args,input:{customerId:f.m.customer_id}}),/ORDER_REQUIRED/);
 await assert.rejects(deskRoute({...args,input:{customerId:f.m.customer_id,orderId:'pg:3'}}),/ORDER_CUSTOMER_MISMATCH/);
 assert.deepEqual(f.calls,['pg:2']);assert.equal(refreshStatus(f.store.db,f.m.customer_id).status,'idle');
 }finally{await f.runner.close();f.store.close();}});
 test('manual UI sends selected order and preserves draft while refreshing order panel',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../backend/public/desk/app.js'),'utf8');
 const detail={},calls=[],reloads=[],files=[{}],context={state:{id:'customer',detail,loadSeq:3,more:false,draft:'unsaved',files},order:()=>({id:'pg:2',order_number:'TEST2'}),renderMore(){},toast(){},customerController:{signal:'signal'},loadCustomerOrders:async(...a)=>reloads.push(a),api:async(...a)=>calls.push(a)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const orderRefreshPending='),source.indexOf('function renderMore()')),context);await vm.runInContext('refreshCustomerOrders()',context);
 assert.equal(calls.length,1);assert.equal(calls[0][1].orderId,'pg:2');assert.equal(reloads[0][2],detail);assert.equal(context.state.draft,'unsaved');assert.equal(context.state.files,files);
 context.order=()=>null;await vm.runInContext('refreshCustomerOrders()',context);assert.equal(calls.length,1);
 });
