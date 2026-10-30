const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs'),{installDesk,listConversations,deskDetail}=require('../backend/desk.cjs');
const {save,createScope,fromHeaders}=require('../backend/mailbox-permissions.cjs');
const actor='dingtalk-'+'a'.repeat(64);
function fixture(){const s=new Store(':memory:');installDesk(s.db);s.addStaff({id:'local-operator',name:'Local'});s.addStaff({id:actor,name:'Agent'});s.addShop({id:'shop-a',name:'A',domain:'a.myshoplaza.com'});s.addShop({id:'shop-b',name:'B',domain:'b.myshoplaza.com'});for(const id of ['a','b']){s.addInbox({id,address:id+'@example.com'});s.linkInboxShop(id,'shop-'+id);}
 const add=(inbox,provider,customerEmail,subject,sentAt)=>s.upsertMessage({inboxId:inbox,providerId:provider,direction:'inbound',customerEmail,fromAddress:customerEmail,subject,bodyText:subject,sentAt});
 const a=add('a','1','shared@example.com','VISIBLE','2026-10-20T00:00:00Z'),b=add('b','2','shared@example.com','SECRET','2026-10-21T00:00:00Z'),hidden=add('b','3','hidden@example.com','PRIVATE','2026-10-22T00:00:00Z');
 return{s,a,b,hidden};}
test('default all, selected/none, administrator bypass, validation and forged role stripping',()=>{const {s}=fixture();try{
 assert.equal(fromHeaders(s,{'x-maildesk-role':'staff','x-maildesk-staff':actor}),null);
 save(s,{staffId:actor,mode:'selected',inboxIds:['a']});assert.deepEqual(fromHeaders(s,{'x-maildesk-role':'staff','x-maildesk-staff':actor}).ids,['a']);assert.equal(fromHeaders(s,{'x-maildesk-role':'admin','x-maildesk-staff':actor}),null);
 save(s,{staffId:actor,mode:'selected',inboxIds:[]});assert.deepEqual(fromHeaders(s,{'x-maildesk-role':'staff','x-maildesk-staff':actor}).ids,[]);
 assert.throws(()=>save(s,{staffId:actor,mode:'selected',inboxIds:['nope']}),/INVALID/);
 const h=require('../backend/reply-stats.cjs').staffHeaders({'x-maildesk-role':'admin','x-maildesk-staff':'spoof'},{corpId:'corp',unionId:'u',role:'staff'});assert.equal(h['x-maildesk-role'],'staff');assert.notEqual(h['x-maildesk-staff'],'spoof');
 save(s,{staffId:actor,mode:'all'});assert.equal(fromHeaders(s,{'x-maildesk-role':'staff','x-maildesk-staff':actor}),null);
 }finally{s.close();}});
test('scoped list counts, search, subject, unread and detail cannot expose hidden inbox',()=>{const {s,a,b,hidden}=fixture();try{
 const scope=createScope(s,actor,['a']);let list=listConversations(s,new URLSearchParams(),null,null,actor,scope);assert.equal(list.total,1);assert.equal(list.rows[0].subject,'VISIBLE');assert.equal(list.rows[0].unread,1);
 assert.equal(listConversations(s,new URLSearchParams({q:'SECRET'}),null,null,actor,scope).total,0);
 assert.equal(listConversations(s,new URLSearchParams(),null,null,actor,createScope(s,actor,[])).total,0);
 const d=scope.detail(deskDetail(s,a.customerId));assert.deepEqual(d.messages.map(m=>m.id),[a.id]);assert.throws(()=>scope.detail(deskDetail(s,hidden.customerId)),/FORBIDDEN/);assert.throws(()=>scope.message(b.id),/FORBIDDEN/);
 s.db.prepare("UPDATE customer_work SET draft='SECRET DRAFT' WHERE customer_id=?").run(a.customerId);assert.equal(scope.detail(deskDetail(s,a.customerId)).work.draft,'');scope.saveDraft(a.customerId,'my draft');assert.equal(scope.detail(deskDetail(s,a.customerId)).work.draft,'my draft');
 }finally{s.close();}});
test('HTTP denies unauthorized messages, mixed read batches, settings and send before side effects',async()=>{
 const {s,a,b,hidden}=fixture();save(s,{staffId:actor,mode:'selected',inboxIds:['a']});
 const {createPilot}=require('../backend/pilot.cjs');const app=createPilot({store:s,vault:{get:()=>({}),status:()=>({})},port:19982,autoSync:false});await app.listen();try{
 const base='http://127.0.0.1:19982',token=(await(await fetch(base+'/api/bootstrap')).json()).token;
 const call=async(path,body,role='staff')=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,origin:base,'content-type':'application/json','x-maildesk-staff':actor,'x-maildesk-role':role},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};};
 require('../backend/files.cjs').saveReceived(s,b.id,[{filename:'secret.txt',content:Buffer.from('secret')}]);
 const hiddenFile=s.db.prepare('SELECT id FROM attachments WHERE message_id=?').get(b.id).id;
 assert.equal((await call('/api/attachments/'+hiddenFile)).status,403);
 const out=require('node:crypto').randomUUID();s.db.prepare('INSERT INTO outgoing VALUES(?,?,?,?,?,?,?,?,?)').run(out,a.customerId,b.id,'shared@example.com','secret subject','secret reply','accepted',actor,new Date().toISOString());s.db.prepare('INSERT INTO outgoing_routes VALUES(?,?,?,?,?)').run(out,'b','b@example.com','shop-b',null);s.db.prepare('INSERT INTO outgoing_files VALUES(?,?,?,?)').run(out,0,'secret.txt',Buffer.from('secret'));
 assert.equal((await call('/api/desk/files/'+out+'/0')).status,403);
 assert.equal((await call('/api/desk/customers/'+a.customerId)).data.outgoing.length,0);
 assert.equal((await call('/api/desk/meta')).data.accounts.inboxes.length,1);
 assert.equal((await call('/api/desk/customers/'+a.customerId)).data.messages.length,1);
 assert.equal((await call('/api/desk/customers/'+hidden.customerId)).status,403);
 assert.equal((await call('/api/read',{messageIds:[a.id,b.id]})).status,403);assert.equal(s.db.prepare('SELECT count(*) n FROM message_reads').get().n,0);
 assert.equal((await call('/api/desk/translate',{messageId:b.id})).status,403);
 assert.equal((await call('/api/send',{messageId:a.id,inboxId:'b',text:'test'})).status,403);
 assert.equal((await call('/api/settings/mailbox-permissions',{staffId:actor,mode:'all'})).status,403);
 const route=await call('/api/reply-route',{messageId:a.id});assert.equal(route.status,200);assert.equal(route.data.inboxId,'a');
 const revision=s.db.prepare('SELECT revision FROM customer_work WHERE customer_id=?').get(a.customerId).revision;
 assert.equal((await call('/api/customers/'+a.customerId,{revision,patch:{draft:'own'}})).status,200);
 assert.equal((await call('/api/desk/customers/'+a.customerId)).data.work.draft,'own');
 assert.equal((await call('/api/desk/customers/'+a.customerId,undefined,'admin')).data.messages.length,2);
 assert.equal((await call('/api/settings/mailbox-permissions',{staffId:actor,mode:'selected',inboxIds:[]},'admin')).status,200);
 assert.equal((await call('/api/desk/conversations')).data.total,0);
 }finally{await app.close();}
});
test('manual link checks the selected order without requiring the unlinked customer lookup',async()=>{
 const {s,a}=fixture(),{shopId}=require('../backend/external-orders.cjs');const domain='a.myshoplaza.com',sid=shopId(domain);s.addShop({id:sid,domain:'fallback.myshoplaza.com',name:'Fallback'});s.linkInboxShop('a',sid);save(s,{staffId:actor,mode:'selected',inboxIds:['a']});let emailQueries=0;
 const database={lookup:{emails:async()=>{emailQueries++;throw Error('ORDER_DATABASE_UNAVAILABLE');},close:async()=>{}},read:async(sql,args)=>{if(sql.includes('WHERE id=$1'))return[{id:args[0],store_subdomain:args[0]==='1'?domain:'b.myshoplaza.com',order_id:'12345-TEST123',order_number:'TEST123',customer_email:'other@example.com'}];return[];},close:async()=>{}};
 const app=require('../backend/pilot.cjs').createPilot({store:s,vault:{get:()=>({}),status:()=>({})},orderDatabase:database,port:19983,autoSync:false});await app.listen();try{const base='http://127.0.0.1:19983',token=(await(await fetch(base+'/api/bootstrap')).json()).token;const call=orderId=>fetch(base+'/api/order-links',{method:'POST',headers:{authorization:'Bearer '+token,origin:base,'content-type':'application/json','x-maildesk-staff':actor,'x-maildesk-role':'staff'},body:JSON.stringify({customerId:a.customerId,messageId:a.id,orderId})});assert.equal((await call('pg:1')).status,200);assert.equal(emailQueries,0);assert.equal(s.db.prepare('SELECT order_id FROM external_order_links WHERE customer_id=?').get(a.customerId).order_id,'pg:1');assert.equal((await call('pg:2')).status,403);}finally{await app.close();}
});
