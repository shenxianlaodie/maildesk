"use strict";
const {createHash}=require('node:crypto');
function install(db){db.exec(`CREATE TABLE IF NOT EXISTS staff_mailbox_access(staff_id TEXT PRIMARY KEY REFERENCES staff(id),inbox_ids TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mailbox_drafts(scope_key TEXT NOT NULL,customer_id TEXT NOT NULL,draft TEXT NOT NULL,PRIMARY KEY(scope_key,customer_id));`);}
function list(db){install(db);return db.prepare('SELECT staff_id,inbox_ids FROM staff_mailbox_access').all().map(r=>({staffId:r.staff_id,inboxIds:JSON.parse(r.inbox_ids)}));}
function save(store,input){install(store.db);store.actor(input.staffId);if(!['all','selected'].includes(input.mode))throw Error('INVALID_MAILBOX_PERMISSION');if(input.mode==='selected'&&(!Array.isArray(input.inboxIds)||input.inboxIds.length>1000||input.inboxIds.some(id=>typeof id!=='string'||!store.db.prepare('SELECT 1 FROM inboxes WHERE id=?').get(id))))throw Error('INVALID_MAILBOX_PERMISSION');
 store.transaction(()=>{if(input.mode==='all')store.db.prepare('DELETE FROM staff_mailbox_access WHERE staff_id=?').run(input.staffId);else store.db.prepare('INSERT OR REPLACE INTO staff_mailbox_access VALUES(?,?,?)').run(input.staffId,JSON.stringify([...new Set(input.inboxIds)].sort()),new Date().toISOString());store.audit('local-operator','staff.mailboxes',input.staffId,{mode:input.mode,inboxIds:input.mode==='all'?null:input.inboxIds});});return{saved:true};}
function fromHeaders(store,headers){
 const role=headers['x-maildesk-role'];if(!role||role==='admin')return null;
 const actor=headers['x-maildesk-staff'];install(store.db);const row=actor?store.db.prepare('SELECT inbox_ids FROM staff_mailbox_access WHERE staff_id=?').get(actor):null;
 if(actor&&!row)return null;return createScope(store,actor||'anonymous',row?JSON.parse(row.inbox_ids):[]);
}
function createScope(store,actor,ids){
 const db=store.db;install(db);const allowed=new Set(ids),shops=new Set(db.prepare('SELECT shop_id FROM inbox_shops WHERE inbox_id IN(SELECT value FROM json_each(?))').all(JSON.stringify(ids)).map(r=>r.shop_id));
 const literal="'"+JSON.stringify(ids).replaceAll("'","''")+"'";
 const shopLiteral="'"+JSON.stringify([...shops]).replaceAll("'","''")+"'";
 const cte=`WITH orders AS (SELECT * FROM main.orders WHERE shop_id IN(SELECT value FROM json_each(${shopLiteral}))), messages AS (SELECT * FROM main.messages WHERE inbox_id IN(SELECT value FROM json_each(${literal}))), outgoing AS (SELECT o.* FROM main.outgoing o JOIN outgoing_routes r ON r.outgoing_id=o.id WHERE r.inbox_id IN(SELECT value FROM json_each(${literal}))) `;
 const key=actor+':'+createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
 const denied=()=>{throw Error('MAILBOX_FORBIDDEN');};
 const inbox=id=>{if(!allowed.has(id))denied();};
 const message=id=>{const m=db.prepare('SELECT * FROM messages WHERE id=?').get(id);if(!m||!allowed.has(m.inbox_id))denied();return m;};
 const customer=id=>{if(!db.prepare('SELECT 1 FROM messages WHERE customer_id=? AND inbox_id IN(SELECT value FROM json_each(?))').get(id,JSON.stringify(ids)))denied();};
 const outgoing=id=>{const r=db.prepare('SELECT inbox_id FROM outgoing_routes WHERE outgoing_id=?').get(id);if(!r||!allowed.has(r.inbox_id))denied();};
 const filterOrders=rows=>rows.filter(o=>shops.has(o.shop_id));
 function work(id,w){return{...w,draft:db.prepare('SELECT draft FROM mailbox_drafts WHERE scope_key=? AND customer_id=?').get(key,id)?.draft||'',reply_inbox_id:allowed.has(w.reply_inbox_id)?w.reply_inbox_id:null};}
 function saveDraft(id,text){if(typeof text!=='string'||text.length>100000)throw Error('INVALID_DRAFT');db.prepare('INSERT OR REPLACE INTO mailbox_drafts VALUES(?,?,?)').run(key,id,text);}
 function detail(d){customer(d.customer.id);d.messages=d.messages.filter(m=>allowed.has(m.inbox_id));d.outgoing=(d.outgoing||[]).filter(o=>{const r=db.prepare('SELECT inbox_id FROM outgoing_routes WHERE outgoing_id=?').get(o.id);return r&&allowed.has(r.inbox_id);});d.orders=filterOrders(d.orders);d.work=work(d.customer.id,d.work);
 const last=[...d.messages].reverse().find(m=>m.direction==='inbound');const chosen=last?db.prepare('SELECT order_id FROM message_order_matches WHERE message_id=?').all(last.id):[];d.preferredOrderId=chosen.length===1&&d.orders.some(o=>o.id===chosen[0].order_id)?chosen[0].order_id:null;d.orderCandidates=[];return d;}
 function accounts(data){return{...data,inboxes:data.inboxes.filter(i=>allowed.has(i.id)),shops:data.shops.filter(s=>shops.has(s.id))};}
 function authorize(path,method,input,params){
 if(path.startsWith('/api/settings')||['/api/accounts','/api/status','/api/workbench','/api/customers','/api/analytics'].includes(path))denied();
 const cm=/^\/api\/(?:desk\/)?customers\/([a-f0-9]{64})$/.exec(path);if(cm)customer(cm[1]);
 const af=/^\/api\/attachments\/([a-f0-9]{64})$/.exec(path);if(af){const a=db.prepare('SELECT message_id FROM attachments WHERE id=?').get(af[1]);if(!a)denied();message(a.message_id);}
 const of=/^\/api\/desk\/files\/([^/]+)\//.exec(path);if(of)outgoing(of[1]);
 const cid=input?.customerId||params.get('customerId');if(cid)customer(cid);
 if(input?.messageId)message(input.messageId);
 if(Array.isArray(input?.messageIds))input.messageIds.forEach(message);
 if(input?.inboxId)inbox(input.inboxId);
 if(input?.patch?.replyInboxId)inbox(input.patch.replyInboxId);
 if(params.get('inbox'))inbox(params.get('inbox'));
 if(input?.requestId&&db.prepare('SELECT 1 FROM outgoing WHERE id=?').get(input.requestId))outgoing(input.requestId);
 if(input?.orderId){let shop=db.prepare('SELECT shop_id FROM orders WHERE id=?').get(input.orderId)?.shop_id;if(shop&&!shops.has(shop))denied();}
 }
 return{actor,ids,allowed,shops,cte,message,inbox,customer,outgoing,filterOrders,detail,accounts,authorize,work,saveDraft};
}
module.exports={install,list,save,fromHeaders,createScope};
