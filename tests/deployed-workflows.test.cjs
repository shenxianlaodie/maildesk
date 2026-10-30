'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Store}=require('../backend/database.cjs');
const {installDesk,listConversations}=require('../backend/desk.cjs');
const {templateOrder}=require('../backend/template-order.cjs');
const {createReadSync,markRemoteRead}=require('../backend/imap-read-sync.cjs');
const {createLargeMailQueue,fetchLargeMessage}=require('../backend/large-mail-queue.cjs');
const {syncImap}=require('../backend/imap.cjs');
function fixture(t){
 const store=new Store(':memory:');t.after(()=>store.close());installDesk(store.db);
 store.addInbox({id:'i',address:'support@example.com'});
 for(const id of ['a','b'])store.addStaff({id,name:id});
 const accounts={source:()=>({id:'i',address:'support@example.com'}),config:()=>({host:'imap.example.com',password:'test',username:'support@example.com'})};
 const message=(uid,extra={})=>({inboxId:'i',providerId:JSON.stringify(['imap','INBOX','1',String(uid)]),direction:'inbound',customerEmail:'customer'+uid+'@example.com',fromAddress:'customer'+uid+'@example.com',sentAt:'2026-10-23T00:00:00Z',subject:'Help',bodyText:'Hello',attachments:[],...extra});
 return {store,accounts,message};
}
test('personal inbox counts isolate agents and unassigned unread conversations',t=>{
 const {store,message}=fixture(t);const m=[1,2,3,4].map(id=>store.upsertMessage(message(id)));
 store.db.prepare('UPDATE customer_work SET assignee_id=? WHERE customer_id=?').run('a',m[0].customerId);
 store.db.prepare('UPDATE customer_work SET assignee_id=? WHERE customer_id=?').run('b',m[1].customerId);
 store.db.prepare('INSERT INTO message_reads VALUES(?,?)').run(m[3].id,'2026-10-23T01:00:00Z');
 const list=(query,actor)=>listConversations(store,new URLSearchParams(query),null,null,actor);
 assert.deepEqual(list('', 'a').counts,{all:4,unreplied:1,pending:1});
 assert.equal(list('filter=unreplied','a').rows[0].id,m[0].customerId);
 assert.equal(list('filter=unreplied','b').rows[0].id,m[1].customerId);
 assert.equal(list('filter=pending','a').rows[0].id,m[2].customerId);
 assert.deepEqual(list('q=customer2@example.com','a').counts,{all:1,unreplied:0,pending:0});
 store.upsertMessage(message(5,{customerEmail:'customer1@example.com',direction:'outbound',sentAt:'2026-10-23T02:00:00Z'}));
 assert.equal(list('filter=unreplied','a').total,0);
});
test('template order persists per active account and rejects invalid lists without overwriting',t=>{
 const {store}=fixture(t);for(const id of ['t1','t2','t3'])store.saveTemplate({id,title:id,keywords:'help',body:'Reply'},'a');
 const initial=templateOrder(store.db,'b');assert.deepEqual(templateOrder(store.db,'a',['t3','t1','t2']),['t3','t1','t2']);
 assert.deepEqual(templateOrder(store.db,'b'),initial);
 for(const ids of [['missing'],['t1','t1'],'t1'])assert.throws(()=>templateOrder(store.db,'a',ids),/INVALID_TEMPLATE_ORDER/);
 assert.deepEqual(templateOrder(store.db,'a'),['t3','t1','t2']);
 store.db.prepare('DELETE FROM templates WHERE id=?').run('t1');store.saveTemplate({id:'t4',title:'New',keywords:'new',body:'New'},'a');
 assert.deepEqual(templateOrder(store.db,'a'),['t3','t2','t4']);
 store.db.prepare('UPDATE staff SET active=0 WHERE id=?').run('b');
 for(const actor of ['b','missing',null])assert.throws(()=>templateOrder(store.db,actor),/STAFF_REQUIRED/);
});
test('read queue preserves a newer unread request while an older read is in flight',async t=>{
 const {store,accounts,message}=fixture(t),m=store.upsertMessage(message(1));let complete;const sent=[];
 const queue=createReadSync(store,accounts,{send:async(c,a,refs)=>{sent.push(refs[0].read);if(sent.length===1)await new Promise(r=>complete=r);return[{uid:'1',status:'done'}];}});
 queue.enqueue([m.id],true);const pending=queue.run();assert.equal(typeof complete,'function');
 queue.enqueue([m.id],false);complete();await pending;
 assert.equal(store.db.prepare('SELECT status FROM imap_read_jobs').get().status,'pending');
 await queue.run();assert.deepEqual(sent,[true,false]);assert.equal(store.db.prepare('SELECT status FROM imap_read_jobs').get().status,'done');await queue.close();
});
test('remote unread removes Seen only from requested UIDs and verifies server state',async()=>{
 const flags=new Set(['\\Seen']);let removed=false,released=false;
 const client={on(){},async connect(){},mailbox:{uidValidity:1n,readOnly:false},async getMailboxLock(folder,options){assert.equal(folder,'INBOX');assert.equal(options.readOnly,false);return{release(){released=true;}};},async fetchAll(uids,query,options){assert.equal(uids,'7');assert.equal(options.uid,true);return[{uid:7,flags}];},async messageFlagsRemove(uids,values,options){assert.equal(uids,'7');assert.deepEqual(values,['\\Seen']);assert.equal(options.uid,true);flags.delete('\\Seen');removed=true;return true;},async logout(){}};
 const result=await markRemoteRead({host:'imap.example.com',password:'test'},'support@example.com',[{uid:'7',folder:'INBOX',validity:'1',read:false}],{createClient:()=>client});
 assert.deepEqual(result,[{uid:'7',status:'done'}]);assert.ok(removed&&released);
 client.mailbox.uidValidity=2n;await assert.rejects(markRemoteRead({host:'imap.example.com',password:'test'},'support@example.com',[{uid:'7',folder:'INBOX',validity:'1'}],{createClient:()=>client}),/IMAP_READ_UIDVALIDITY_CHANGED/);
});
test('large mail retries, imports once, preserves bytes and honors disabled auto sync',async t=>{
 const {store,accounts,message}=fixture(t);const mail=message(9,{attachments:[{filename:'proof.txt',contentType:'text/plain',content:Buffer.from('proof')}]});
 store.db.prepare('INSERT INTO imap_skips VALUES(?,?,?)').run('i',mail.providerId,'MESSAGE_LARGE_DEFERRED');
 let enabled=false,calls=0,now=0,imported=0;
 const queue=createLargeMailQueue(store,accounts,{enabled:()=>enabled,clock:()=>now,onImport:()=>imported++,fetchMessage:async()=>{calls++;if(calls===1)throw Error('IMAP_LARGE_DOWNLOAD_FAILED');return mail;}});
 assert.equal(await queue.processNext(),false);assert.equal(calls,0);enabled=true;
 await queue.processNext();assert.equal(store.db.prepare('SELECT status FROM large_mail_jobs').get().status,'retry');
 assert.equal(await queue.processNext(),false);now=1000000;await queue.processNext();await queue.processNext();
 assert.equal(calls,2);assert.equal(imported,1);assert.equal(store.db.prepare('SELECT count(*) n FROM messages').get().n,1);
 assert.equal(store.db.prepare('SELECT count(*) n FROM imap_skips').get().n,0);
 assert.equal(Buffer.from(store.db.prepare('SELECT content FROM file_contents').get().content).toString(),'proof');await queue.close();
});
test('oversized large mail is rejected before download; changed mailbox identity also fails',async()=>{
 let downloaded=false;const client={on(){},async connect(){},mailbox:{uidValidity:1n},async getMailboxLock(){return{release(){}};},async fetchOne(){return{uid:1,size:51*1024*1024,internalDate:new Date('2026-10-23T00:00:00Z')};},async download(){downloaded=true;},close(){}};
 const config={host:'imap.example.com',password:'test'},inbox={id:'i',address:'support@example.com'},id=JSON.stringify(['imap','INBOX','1','1']);
 await assert.rejects(fetchLargeMessage(config,inbox,id,{createClient:()=>client}),/IMAP_LARGE_SIZE_REVIEW/);assert.equal(downloaded,false);
 client.mailbox.uidValidity=2n;await assert.rejects(fetchLargeMessage(config,inbox,id,{createClient:()=>client}),/IMAP_LARGE_UID_CHANGED/);
});
test('automatic IMAP sync enforces exact cutoff and defers large messages without downloading',async()=>{
 const cutoff='2026-10-22T04:00:00.000Z',reasons=[],downloads=[];
 const client={on(){},async connect(){},async list(){return[];},mailbox:{exists:3,uidValidity:1n},async getMailboxLock(){return{release(){}};},async search(query,options){assert.equal(query.since.toISOString(),cutoff);assert.equal(options.uid,true);return[1,2,3];},async fetchAll(){return[{uid:1,size:10,internalDate:new Date('2026-10-22T03:59:59Z')},{uid:2,size:6*1024*1024,internalDate:new Date(cutoff)},{uid:3,size:10,internalDate:new Date(cutoff)}];},async fetchOne(uid){downloads.push(uid);return{source:Buffer.from('mail')};},async logout(){},close(){}};
 const result=await syncImap({host:'imap.example.com',password:'test'},{id:'i',address:'support@example.com'},()=>{},{automatic:true,syncSince:cutoff,createClient:()=>client,onSkip:(id,reason)=>reasons.push(reason),parse:async()=>({from:{value:[{address:'customer@example.com'}]},to:{value:[{address:'support@example.com'}]},text:'Hello'})});
 assert.equal(result.processed,1);assert.deepEqual(downloads,[3]);assert.deepEqual(new Set(reasons),new Set(['BEFORE_SYNC_START','MESSAGE_LARGE_DEFERRED']));
});
test('email presentation escapes customer text and keeps quoted original available',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
 const context=vm.createContext({});vm.runInContext(source.match(/const esc=.*\r?\n/)[0]+source.slice(source.indexOf('function splitEmailQuote('),source.indexOf('\nfunction renderThread(')),context);
 const html=context.emailBody('My reply <script>alert(1)</script>\n\nOn Thu, a customer wrote:\n> original <img src=x>');
 assert.ok(html.includes('<details class="email-quote">'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('original &lt;img src=x&gt;'));assert.ok(!html.includes('<script>'));
 assert.equal(context.splitEmailQuote('Only original text').quote,'');
});
