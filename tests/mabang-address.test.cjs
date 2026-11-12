const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createMabangAddress}=require('../backend/mabang-address.cjs');
const {createHash}=require('node:crypto');
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE staff(id TEXT PRIMARY KEY,display_name TEXT,active INTEGER);INSERT INTO staff VALUES('alice','Alice',1)");
 const events=[];const store={db,transaction:fn=>{db.exec('BEGIN');try{fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},audit:(...a)=>events.push(a)};
 let rows=[],fail=false;
 const svc=createMabangAddress(store,async()=>{if(fail)throw Error('offline');return rows;});
 const row=(id,extra={})=>({id:String(id),store_subdomain:'shop.myshoplaza.com',order_id:'o1',order_number:'ORDER1',actor:'maildesk:customer:hash',status:'succeeded',completed_at:`2026-11-10T00:${String(id).padStart(2,'0')}:00Z`,before_address_json:{address:'Old'},after_address_json:{address:'New'+id},...extra});
 return{db,svc,events,row,set:r=>rows=r,fail:()=>fail=true};
}
test('imports every successful source, folds orders, excludes failures and preserves history',async()=>{
 const f=fixture();f.set([f.row(1),f.row(2,{actor:'maildesk:staff'}),f.row(3,{status:'conflict',order_id:'bad'}),f.row(4,{order_id:'o2'})]);await f.svc.refresh();
 const list=f.svc.list();assert.equal(list.pending,2);assert.equal(list.rows.find(r=>r.order_id==='o1').request_id,'2');assert.equal(f.svc.history('2').length,2);
 await f.svc.refresh();assert.equal(f.db.prepare('SELECT count(*) n FROM mabang_address_changes').get().n,3);
});
test('confirmation records staff once and a newer success reopens the order',async()=>{
 const f=fixture();f.set([f.row(1)]);await f.svc.refresh();await f.svc.confirm('1','alice');await f.svc.confirm('1','alice');assert.equal(f.events.length,1);assert.equal(f.svc.list().pending,0);assert.equal(f.svc.list({status:'done'}).rows[0].confirmed_by,'Alice');
 f.set([f.row(1),f.row(2)]);await f.svc.refresh();assert.equal(f.svc.list().pending,1);assert.equal(f.svc.list().rows[0].request_id,'2');
});
test('new success discovered during confirmation rejects stale confirmation',async()=>{
 const f=fixture();f.set([f.row(1)]);await f.svc.refresh();f.set([f.row(1),f.row(2)]);await assert.rejects(f.svc.confirm('1','alice'),/MABANG_ADDRESS_CHANGED/);assert.equal(f.events.length,0);
});
test('scope protects list, history, count and confirmation',async()=>{
 const f=fixture();f.set([f.row(1)]);await f.svc.refresh();const denied={shops:new Set()};assert.equal(f.svc.list({scope:denied}).pending,0);assert.throws(()=>f.svc.history('1',denied),/MAILBOX_FORBIDDEN/);await assert.rejects(f.svc.confirm('1','alice',denied),/MAILBOX_FORBIDDEN/);
 const allowed={shops:new Set([createHash('sha256').update('postgres-shop\0shop.myshoplaza.com').digest('hex')])};assert.equal(f.svc.list({scope:allowed}).pending,1);
});
test('remote failure preserves pending work and blocks confirmation',async()=>{
 const f=fixture();f.set([f.row(1)]);await f.svc.refresh();f.fail();await assert.rejects(f.svc.confirm('1','alice'),/MABANG_SYNC_UNAVAILABLE/);assert.equal(f.svc.list().pending,1);assert.ok(f.svc.list().error);assert.equal(f.events.length,0);
});
test('lower request id completing later wins and is not skipped',async()=>{
 const f=fixture();f.set([f.row(20)]);await f.svc.refresh();await f.svc.confirm('20','alice');f.set([f.row(20),f.row(1,{completed_at:'2026-11-11T00:00:00Z'})]);await f.svc.refresh();assert.equal(f.svc.list().rows[0].request_id,'1');
});
test('batch confirms selected orders atomically and remains idempotent',async()=>{
 const f=fixture();f.set([f.row(1),f.row(2,{order_id:'o2'})]);await f.svc.refresh();
 await f.svc.confirmMany(['1','2'],'alice');assert.equal(f.svc.list().pending,0);assert.equal(f.events.length,2);
 await f.svc.confirmMany(['1','2'],'alice');assert.equal(f.events.length,2);
});
test('batch rejects stale, unauthorized and invalid selections without partial writes',async()=>{
 const f=fixture();f.set([f.row(1),f.row(2,{order_id:'o2'})]);await f.svc.refresh();
 await assert.rejects(f.svc.confirmMany(['1','2'],'alice',{shops:new Set()}),/MAILBOX_FORBIDDEN/);
 await assert.rejects(f.svc.confirmMany([],'alice'),/INVALID_REQUEST/);
 f.set([f.row(1),f.row(2,{order_id:'o2'}),f.row(3,{order_id:'o2'})]);
 await assert.rejects(f.svc.confirmMany(['1','2'],'alice'),/MABANG_ADDRESS_CHANGED/);assert.equal(f.events.length,0);assert.equal(f.svc.list().pending,2);
});
