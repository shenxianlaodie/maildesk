'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Store}=require('../backend/database.cjs'),{sendReply}=require('../backend/smtp.cjs');
function fixture(t){const store=new Store(':memory:');t.after(()=>store.close());store.addInbox({id:'inbox',address:'support@example.com'});for(const id of ['a','b'])store.addStaff({id,name:id});store.db.prepare('INSERT INTO assignment_rules VALUES(?,?)').run('inbox','b');const message={inboxId:'inbox',providerId:'m1',direction:'inbound',customerEmail:'customer@example.com',fromAddress:'customer@example.com',sentAt:new Date(),subject:'Help'};const m=store.upsertMessage(message);const pilot={inboxId:'inbox',address:'support@example.com',actor:'a'},config={testRecipients:['customer@example.com']};const work=()=>store.detail(m.customerId).work;const send=(actor,make)=>sendReply(store,config,{...pilot,actor},{requestId:randomUUID(),messageId:m.id,text:'Reply'},make||(()=>({sendMail:async()=>({accepted:['customer@example.com']}),close(){}})));return{store,message,m,work,send};}
test('unassigned until first accepted reply; failed and uncertain delivery do not claim ownership',async t=>{
 const {store,m,work,send}=fixture(t);assert.equal(work().assignee_id,null);
 for(const code of ['EAUTH','ETIMEDOUT']){const result=await send('b',()=>({sendMail:async()=>{const e=Error('send error');e.code=code;throw e;},close(){}}));assert.equal(result.status,code==='EAUTH'?'failed':'unknown');assert.equal(work().assignee_id,null);}
 assert.equal((await send('a')).status,'accepted');assert.equal(work().assignee_id,'a');assert.equal(work().status,'done');
 await send('b');assert.equal(work().assignee_id,'a');
 store.saveWork(m.customerId,{assigneeId:null},work().revision,'a');await send('b');assert.equal(work().assignee_id,null);
 assert.equal(store.db.prepare("SELECT count(*) n FROM audit_events WHERE action='customer.first_reply_assignment'").get().n,1);
});
test('manual owner stays assigned even when another agent sends the first reply',async t=>{const {store,m,work,send}=fixture(t);store.saveWork(m.customerId,{assigneeId:'b'},work().revision,'b');await send('a');assert.equal(work().assignee_id,'b');});
test('first completed send wins concurrent replies and new inbound mail keeps the thread pending',async t=>{
 const {store,message,work,send}=fixture(t);const pending=[];const make=()=>({sendMail:()=>new Promise(resolve=>pending.push(resolve)),close(){}});
 const first=send('a',make),second=send('b',make);assert.equal(pending.length,2);
 store.upsertMessage({...message,providerId:'m2'});
 pending[1]({accepted:['customer@example.com']});await second;assert.equal(work().assignee_id,'b');assert.equal(work().status,'pending');
 pending[0]({accepted:['customer@example.com']});await first;assert.equal(work().assignee_id,'b');assert.equal(work().status,'pending');
});
