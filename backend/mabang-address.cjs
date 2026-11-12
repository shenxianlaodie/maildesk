'use strict';
const {createHash}=require('node:crypto');
const domain=value=>String(value).replace(/\.myshoplaza\.com$/i,'').toLowerCase();
const key=r=>domain(r.store_subdomain)+':'+r.order_id;
function install(db){db.exec(`
 CREATE TABLE IF NOT EXISTS mabang_address_changes (
 request_id TEXT PRIMARY KEY,order_key TEXT NOT NULL,store_domain TEXT NOT NULL,
 order_id TEXT NOT NULL,order_number TEXT NOT NULL,shop_id TEXT NOT NULL,
 actor TEXT NOT NULL,completed_at TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS mabang_address_order ON mabang_address_changes(order_key,completed_at);
 CREATE TABLE IF NOT EXISTS mabang_address_confirmations (
 request_id TEXT PRIMARY KEY,actor TEXT NOT NULL,actor_name TEXT NOT NULL,confirmed_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS mabang_address_meta (id INTEGER PRIMARY KEY CHECK(id=1),last_success TEXT,error TEXT);
 INSERT OR IGNORE INTO mabang_address_meta(id,last_success,error) VALUES(1,NULL,NULL);
`);}
const latest=`WITH ranked AS (SELECT c.*,row_number() OVER(PARTITION BY order_key ORDER BY completed_at DESC,length(request_id) DESC,request_id DESC) rank FROM mabang_address_changes c)
 SELECT r.*,a.actor_name confirmed_by,a.confirmed_at FROM ranked r LEFT JOIN mabang_address_confirmations a ON a.request_id=r.request_id WHERE r.rank=1`;
function createMabangAddress(store,fetchSuccesses,{interval=60000,clock=()=>new Date().toISOString()}={}){
 const db=store.db;install(db);let active=null,timer=null,closed=false;
 const allowed=(row,scope)=>!scope||scope.shops.has(row.shop_id);
 const view=row=>({...row,before:JSON.parse(row.before_json),after:JSON.parse(row.after_json),before_json:undefined,after_json:undefined,source:row.actor.startsWith('maildesk:customer:')?'customer':'staff',pending:!row.confirmed_at});
 async function refresh(){
  if(active)return active;
  active=(async()=>{try{
   const rows=await fetchSuccesses();
   // Fetch every page before writing locally: a failed fetch must not look complete.
   store.transaction(()=>{
    const insert=db.prepare('INSERT OR IGNORE INTO mabang_address_changes VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(const r of rows){
     if(r.status!=='succeeded')continue;
     if(!/^\d+$/.test(String(r.id))||!r.after_address_json||typeof r.after_address_json!=='object'||!r.completed_at)throw Error('MABANG_INVALID_RECORD');
     const shopId=createHash('sha256').update('postgres-shop\0'+r.store_subdomain).digest('hex');
     insert.run(String(r.id),key(r),r.store_subdomain,r.order_id,r.order_number||r.order_id,shopId,r.actor||'',new Date(r.completed_at).toISOString(),JSON.stringify(r.before_address_json||{}),JSON.stringify(r.after_address_json));
    }
    db.prepare('UPDATE mabang_address_meta SET last_success=?,error=NULL WHERE id=1').run(clock());
   });
  }catch(e){db.prepare('UPDATE mabang_address_meta SET error=? WHERE id=1').run('改址记录同步失败，请刷新重试');throw Error('MABANG_SYNC_UNAVAILABLE');}})();
  try{await active;}finally{active=null;}
 }
 function list({scope=null,status='pending',q=''}={}){
  if(!['pending','done','all'].includes(status))throw Error('INVALID_STATUS');
  const rows=db.prepare(latest+' ORDER BY completed_at DESC').all().filter(r=>allowed(r,scope));
  const term=String(q).trim().toLowerCase();
  const filtered=rows.filter(r=>(status==='all'||(status==='pending'?!r.confirmed_at:!!r.confirmed_at))&&(!term||[r.order_number,r.store_domain].some(x=>x.toLowerCase().includes(term))));
  return {rows:filtered.map(view),pending:rows.filter(r=>!r.confirmed_at).length,total:filtered.length,...db.prepare('SELECT last_success,error FROM mabang_address_meta WHERE id=1').get()};
 }
 function history(requestId,scope){
  const r=db.prepare('SELECT * FROM mabang_address_changes WHERE request_id=?').get(String(requestId));
  if(!r||!allowed(r,scope))throw Error('MAILBOX_FORBIDDEN');
  return db.prepare('SELECT c.*,a.actor_name confirmed_by,a.confirmed_at FROM mabang_address_changes c LEFT JOIN mabang_address_confirmations a ON a.request_id=c.request_id WHERE order_key=? ORDER BY completed_at DESC,length(c.request_id) DESC,c.request_id DESC').all(r.order_key).map(view);
 }
 async function confirmMany(requestIds,actor,scope){
  if(!Array.isArray(requestIds)||!requestIds.length)throw Error('INVALID_REQUEST');
  const ids=[...new Set(requestIds)];
  for(const requestId of ids){
  if(typeof requestId!=='string'||!/^\d+$/.test(requestId))throw Error('INVALID_REQUEST');
  }
  const staff=db.prepare('SELECT id,display_name FROM staff WHERE id=? AND active=1').get(actor);
  if(!staff)throw Error('STAFF_REQUIRED');
  const targets=ids.map(requestId=>{const target=db.prepare('SELECT * FROM mabang_address_changes WHERE request_id=?').get(requestId);
  if(!target||!allowed(target,scope))throw Error('MAILBOX_FORBIDDEN');
  return target;});
  await refresh(); // Never acknowledge a stale address when a newer success exists.
  for(const target of targets){const row=db.prepare(latest+' AND r.order_key=?').get(target.order_key);
  if(row.request_id!==target.request_id)throw Error('MABANG_ADDRESS_CHANGED');}
  store.transaction(()=>{
   for(const target of targets){const requestId=target.request_id;
   const saved=db.prepare('INSERT OR IGNORE INTO mabang_address_confirmations VALUES(?,?,?,?)').run(requestId,staff.id,staff.display_name,clock());
   if(saved.changes)store.audit(actor,'order.mabang_address_confirmed',target.order_id,{requestId,store:target.store_domain});}
  });
  return {saved:true};
 }
 async function confirm(requestId,actor,scope){return confirmMany([requestId],actor,scope);}
 async function tick(){if(closed)return;try{await refresh();}catch{}finally{if(!closed){timer=setTimeout(tick,interval);timer.unref();}}}
 return {refresh,list,history,confirm,confirmMany,start:()=>{if(!closed&&!timer){timer=setTimeout(tick,1000);timer.unref();}},close:async()=>{closed=true;clearTimeout(timer);await active?.catch(()=>{});}};
}
module.exports={createMabangAddress};
