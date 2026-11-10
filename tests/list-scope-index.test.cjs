'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {installDesk,listConversations}=require('../backend/desk.cjs');
const {createScope}=require('../backend/mailbox-permissions.cjs');
test('mailbox visibility and unread checks use covering indexes without changing scoped results',()=>{
 const store=new Store(':memory:');
 try{
  installDesk(store.db);store.addStaff({id:'a',name:'a'});
  for(const inbox of ['allowed','hidden'])store.addInbox({id:inbox,address:inbox+'@example.com'});
  for(const inbox of ['allowed','hidden'])store.upsertMessage({inboxId:inbox,providerId:inbox,direction:'inbound',customerEmail:inbox+'@example.com',fromAddress:inbox+'@example.com',sentAt:'2026-11-10T00:00:00Z'});
  const scope=createScope(store,'a',['allowed']);
  for(const predicate of [''," AND direction='inbound'"]){
   const steps=store.db.prepare('EXPLAIN QUERY PLAN '+scope.cte+'SELECT id FROM messages WHERE customer_id=?'+predicate).all('customer');
   assert.ok(steps.some(s=>/COVERING INDEX.*customer_inbox_direction_sent/.test(s.detail)),JSON.stringify(steps));
  }
  const result=listConversations(store,new URLSearchParams({filter:'pending'}),[],null,'a',scope);
  assert.equal(result.total,1);assert.equal(result.rows[0].email,'allowed@example.com');
  assert.equal(result.rows[0].unread,1);
 }finally{store.close();}
});
