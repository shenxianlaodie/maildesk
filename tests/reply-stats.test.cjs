const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const {Store}=require('../backend/database.cjs'),{replyStats,staffHeaders,sendingActor}=require('../backend/reply-stats.cjs'),{sendReply}=require('../backend/smtp.cjs');
function fixture(){const store=new Store(':memory:');const identity={corpId:'corp',unionId:'one'},id=staffHeaders({},identity)['x-maildesk-staff'];store.addStaff({id,name:'Agent'});store.addStaff({id:'local-operator',name:'Local'});store.addInbox({id:'inbox',address:'support@example.com'});const message=store.upsertMessage({inboxId:'inbox',providerId:'m',direction:'inbound',customerEmail:'customer@example.com',fromAddress:'customer@example.com',sentAt:new Date(),subject:'Help'});return{store,identity,id,message};}
test('Beijing day/hour counts accepted records at exact boundaries, includes zero staff and legacy separately',()=>{
 const {store,id,message}=fixture();try{
 store.addStaff({id:'zero',name:'Zero'});
 const add=(at,status='accepted',actor=id)=>store.db.prepare('INSERT INTO outgoing VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),message.customerId,message.id,'customer@example.com','Re','Body',status,actor,at);
 add('2026-10-20T15:59:59.999Z');add('2026-10-20T16:00:00.000Z');add('2026-10-20T16:59:59.999Z');add('2026-10-20T17:00:00.000Z');add('2026-10-21T16:00:00.000Z');
 for(const status of ['failed','unknown','sending','demo'])add('2026-10-20T16:30:00.000Z',status);
 add('2026-10-20T18:00:00.000Z','accepted','local-operator');
 const day=replyStats(store.db,new URLSearchParams({date:'2026-10-21'}));assert.equal(day.total,4);assert.equal(day.rows.find(r=>r.id===id).count,3);assert.equal(day.rows.find(r=>r.id==='zero').count,0);assert.match(day.rows.find(r=>r.id==='local-operator').name,/历史未归属/);
 const hour=replyStats(store.db,new URLSearchParams({date:'2026-10-21',period:'hour',hour:'0'}));assert.equal(hour.total,2);assert.equal(hour.start,'2026-10-20T16:00:00.000Z');
 assert.equal(replyStats(store.db,new URLSearchParams({date:'2026-10-21',period:'hour',hour:'1'})).total,1);
 for(const params of [{date:'2026-02-30'},{date:'bad'},{date:'2026-10-21',hour:'24'},{date:'2026-10-21',period:'week'}])assert.throws(()=>replyStats(store.db,new URLSearchParams(params)),/INVALID_STATS_RANGE/);
 }finally{store.close();}
});
test('authenticated sender overrides forged headers; SMTP retries count one accepted reply',async()=>{
 const {store,identity,id,message}=fixture();try{
 const headers=staffHeaders({'x-maildesk-staff':'spoof'},identity);assert.equal(headers['x-maildesk-staff'],id);assert.equal(staffHeaders({'x-maildesk-staff':id},null)['x-maildesk-staff'],undefined);
 assert.throws(()=>sendingActor(store,{'x-maildesk-staff':'bad'},'local-operator'),/INVALID/);
 const pilot={inboxId:'inbox',address:'support@example.com',actor:sendingActor(store,headers,'local-operator')};
 const input={requestId:randomUUID(),messageId:message.id,text:'Reply'},config={testRecipients:['customer@example.com']};let sends=0;
 const transport=()=>({sendMail:async()=>{sends++;return{accepted:['customer@example.com']};},close(){}});
 await sendReply(store,config,pilot,input,transport);await sendReply(store,config,pilot,input,transport);
 assert.equal(sends,1);assert.equal(store.db.prepare('SELECT actor_id FROM outgoing').get().actor_id,id);assert.equal(replyStats(store.db,new URLSearchParams()).total,1);
 const second=staffHeaders({}, {corpId:'corp',unionId:'two'})['x-maildesk-staff'];store.addStaff({id:second,name:'Agent'});await sendReply(store,config,{...pilot,actor:sendingActor(store,{'x-maildesk-staff':second},'local-operator')},{...input,requestId:randomUUID()},transport);
 const rows=replyStats(store.db,new URLSearchParams()).rows;assert.equal(rows.find(r=>r.id===id).count,1);assert.equal(rows.find(r=>r.id===second).count,1);
 }finally{store.close();}
});
test('statistics read is allowed for ordinary staff; no write endpoint is exposed',()=>{const {permitted}=require('../backend/lan/proxy.cjs');assert.equal(permitted('GET','/api/desk/reply-stats'),true);assert.equal(permitted('POST','/api/desk/reply-stats'),false);});

test('stats visibility is bound to authenticated identity, includes only own total, and fails closed',()=>{
 const {visibleReplyStats}=require('../backend/reply-stats.cjs');
 for(const identity of [{corpId:'corp',unionId:'one',role:'staff'},{auth:'password',username:'Agent',role:'staff'}]){
 const id=staffHeaders({},identity)['x-maildesk-staff'];const data={date:'2026-10-26',period:'day',total:233,rows:[{id,name:'Self',count:104},{id:'other',name:'Other',count:129}]};
 const own=visibleReplyStats(data,identity);assert.equal(own.total,104);assert.equal(own.rows.length,1);assert.equal(own.rows[0].id,id);
 assert.equal(visibleReplyStats(data,{...identity,role:'admin'}),data);
 assert.deepEqual(visibleReplyStats(data,null).rows,[]);assert.equal(visibleReplyStats(data,null).total,0);
 }
});
