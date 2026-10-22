const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {Store}=require('../backend/database.cjs'),{accounts}=require('../backend/accounts.cjs'),{sendReply}=require('../backend/smtp.cjs');
test('accounts isolate credentials, retain blank secrets, route replies by inbound mailbox',async()=>{
 const store=new Store(':memory:'),values={},vault={get:k=>values[k]||{},set:(k,v,p)=>{assert.equal(p,true);values[k]=v;}};
 const pilot={shopId:'s0',inboxId:'i0',address:'original@example.com',actor:'staff'};
 store.addShop({id:'s0',name:'original',domain:'original.myshoplaza.com'});store.addInbox({id:'i0',address:pilot.address});store.addStaff({id:'staff',name:'staff'});values.zoho={password:'original-secret'};
 const a=accounts(store,vault,pilot);try{
 const shop=a.save({provider:'shoplazza',name:'Second',domain:'second.myshoplaza.com',token:'shop-secret'});
 const input={provider:'zoho',address:'second@example.com',host:'imappro.zoho.com',password:'mail-secret',smtpPassword:'send-secret',shopIds:[shop.id],staffId:'staff'};
 const inbox=a.save(input);a.save({...input,id:inbox.id,password:'',smtpPassword:'',enabled:false});
 assert.equal(a.config('zoho',inbox.id).password,'mail-secret');assert.equal(a.config('smtp',inbox.id).password,'send-secret');assert.equal(values.zoho.password,'original-secret');assert.equal(a.enabled('zoho',inbox.id),false);assert.ok(!JSON.stringify(a.list()).includes('secret'));
 assert.throws(()=>a.save({...input,id:inbox.id,address:'changed@example.com'}),/ACCOUNT_IDENTITY_IMMUTABLE/);assert.throws(()=>a.save(input),/ACCOUNT_ALREADY_EXISTS/);
 const mail=store.upsertMessage({inboxId:inbox.id,providerId:'1',direction:'inbound',customerEmail:'customer@example.com',fromAddress:'customer@example.com',toAddresses:[input.address],sentAt:new Date().toISOString(),bodyText:'hello'});
 assert.equal(store.detail(mail.customerId).work.assignee_id,null);
 const route=a.reply(mail.id);assert.equal(route.pilot.address,input.address);assert.equal(route.config.password,'send-secret');store.db.prepare('INSERT OR REPLACE INTO app_settings VALUES(?,?)').run('sending_mode','real');let sent;
 const result=await sendReply(store,route.config,route.pilot,{requestId:randomUUID(),messageId:mail.id,text:'test'},(config,address)=>{assert.equal(config.password,'send-secret');assert.equal(address,input.address);return{sendMail:async m=>{sent=m;return{accepted:[m.to]};},close(){}};});
 assert.equal(result.status,'accepted');assert.equal(sent.from,'second@example.com');assert.equal(sent.to,'customer@example.com');
 }finally{store.close();}
});
test('failed encrypted save does not expose a new account',()=>{const s=new Store(':memory:');try{const a=accounts(s,{get:()=>({}),set:()=>{throw Error('SECURE_STORAGE_UNAVAILABLE');}},{});assert.throws(()=>a.save({provider:'shoplazza',name:'test',domain:'test.myshoplaza.com',token:'secret'}),/SECURE_STORAGE_UNAVAILABLE/);assert.equal(s.counts().shops,0);}finally{s.close();}});

test('reply prefers contacted inbox, then unique order-shop match, otherwise picks most recently contacted inbox',()=>{
 const s=new Store(':memory:');try{
  for(const id of ['a','b','c']){s.addShop({id,name:id,domain:id+'.myshoplaza.com'});s.addInbox({id,address:id+'@example.com'});s.linkInboxShop(id,id);}
  const a=accounts(s,{get:()=>({password:'secret'})},{});
  const incoming=id=>s.upsertMessage({inboxId:id,providerId:id+'1',direction:'inbound',customerEmail:'buyer@example.com',fromAddress:'buyer@example.com',sentAt:id==='a'?'2026-10-21T10:00:00Z':'2026-10-20T10:00:00Z'});
  const m=incoming('b');const orders=[{id:'order-a',shop_id:'a'},{id:'order-c',shop_id:'c'}];
  assert.equal(a.reply(m.id,'order-a',undefined,orders).pilot.inboxId,'b');
  assert.throws(()=>a.reply(m.id,'order-a','a',orders),/REPLY_SHOP_INBOX_MISMATCH/);
  incoming('a');
  assert.equal(a.reply(m.id,'order-a',undefined,orders).pilot.inboxId,'a');
  assert.equal(a.reply(m.id,'order-c',undefined,orders).pilot.inboxId,'a');
  assert.equal(a.reply(m.id,'order-c','b',orders).pilot.inboxId,'b');
  assert.equal(a.reply(m.id,undefined,undefined,orders).pilot.inboxId,'a');
  s.linkInboxShop('b','a');
  assert.equal(a.reply(m.id,'order-a',undefined,orders).pilot.inboxId,'a');
  assert.equal(a.reply(m.id,'order-a','a',orders).pilot.inboxId,'a');
  assert.throws(()=>a.reply(m.id,'unrelated',undefined,orders),/ORDER_CUSTOMER_MISMATCH/);
 }finally{s.close();}
});
