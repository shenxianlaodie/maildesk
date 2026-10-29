const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {installDesk,listConversations}=require('../backend/desk.cjs');
test('sort uses all customers before pagination and inbound time rather than reply time',()=>{
 const s=new Store(':memory:');try{
  installDesk(s.db);s.addInbox({id:'inbox',address:'support@example.com'});
  for(let i=0;i<45;i++)s.upsertMessage({inboxId:'inbox',providerId:String(i),direction:'inbound',customerEmail:`c${i}@example.com`,customerName:`Customer ${String(i).padStart(2,'0')}`,fromAddress:`c${i}@example.com`,sentAt:new Date(Date.UTC(2026,0,1+i))});
  s.upsertMessage({inboxId:'inbox',providerId:'reply',direction:'outbound',customerEmail:'c0@example.com',fromAddress:'support@example.com',sentAt:'2026-10-21T12:00:00Z'});
  const rows=q=>listConversations(s,new URLSearchParams(q)).rows;
  assert.equal(rows('sort=name_asc')[0].display_name,'Customer 00');
  assert.equal(rows('sort=name_asc&page=1')[0].display_name,'Customer 40');
  assert.equal(rows('sort=name_desc')[0].display_name,'Customer 44');
  assert.equal(rows('sort=time_desc')[0].email,'c44@example.com');
  assert.equal(rows('sort=time_asc')[0].email,'c0@example.com');
  assert.equal(rows('')[0].email,'c0@example.com');
  assert.throws(()=>rows('sort=invalid'),/INVALID_SORT/);
 }finally{s.close();}
});
