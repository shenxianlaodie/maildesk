'use strict';
const {shopId,shopDisplayName}=require('./external-orders.cjs');
const identity=o=>(o.shop_domain||'')+'\0'+o.provider_id;
const keys=orders=>orders.map(o=>({domain:o.shop_domain,provider:o.provider_id,number:String(o.order_number).toUpperCase()}));
const nonempty=v=>v!==undefined&&v!==null&&v!==''&&v!=='unknown'&&(!Array.isArray(v)||v.length>0);
function mergeOrders(primary,legacy){
 const all=[];
 for(const o of [...primary,...legacy]){
  const i=all.findIndex(r=>r.shop_domain===o.shop_domain&&(r.provider_id===o.provider_id||String(r.order_number).toUpperCase()===String(o.order_number).toUpperCase()));
  if(i<0){all.push({...o,aliases:[o.id],emails:[...new Set([o.customer_email,...o.emails||[]].filter(Boolean))],sources:[o.source]});continue;}
  const prev=all[i],newer=(Date.parse(o.provider_updated_at)||0)>(Date.parse(prev.provider_updated_at)||0)?o:prev,older=newer===o?prev:o;
  const merged={...older};for(const[k,v]of Object.entries(newer))if(nonempty(v))merged[k]=v;
  merged.local={...older.local};for(const[k,v]of Object.entries(newer.local||{}))if(nonempty(v))merged.local[k]=v;
  const pg=prev.id.startsWith('pg:')?prev:o.id.startsWith('pg:')?o:null;
  merged.id=pg?.id||prev.id;merged.source=pg?'postgresql':'chatwoot';merged.shop_name=pg?.shop_name||prev.shop_name;
  merged.aliases=[...new Set([...prev.aliases,o.id])];merged.sources=[...new Set([...prev.sources,o.source])];merged.emails=[...new Set([...prev.emails,o.customer_email,...o.emails||[]].filter(Boolean))];
  merged.shipments=[...new Map([...prev.shipments,...o.shipments].map(s=>[s.tracking_number.toUpperCase(),s])).values()];
  if(pg)for(const shipment of merged.shipments){const known=pg.shipments.find(s=>s.tracking_number.trim().toUpperCase()===shipment.tracking_number.trim().toUpperCase());if(known&&typeof known.historical==='boolean'){shipment.historical=known.historical;if(known.historical)shipment.currentTrackingNumber=known.currentTrackingNumber;}}merged.shipments.sort((a,b)=>Number(!!a.historical)-Number(!!b.historical));
  merged.shipped_at=[prev.shipped_at,o.shipped_at].filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||null;
  merged.virtualProgress=newer.virtualProgress;
  all[i]=merged;
 }
 return all.sort((a,b)=>(Date.parse(b.placed_at)||0)-(Date.parse(a.placed_at)||0));
}
function combinedOrders(store,primary,legacy,{sourceTimeoutMs=1500,clock=Date.now}={}){
 const db=store.db;
 const {AsyncLocalStorage}=require('node:async_hooks'),context=new AsyncLocalStorage();
 db.exec('CREATE TABLE IF NOT EXISTS order_source_cache(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 const unavailable=e=>/^(ORDER_DATABASE_UNAVAILABLE|LEGACY_ORDER_DATABASE_UNAVAILABLE)$/.test(e.message)||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','57P01','53300','57014'].includes(e.code)||/connection timeout|Connection terminated|timeout exceeded when trying to connect/i.test(e.message);
 function guarded(source,{persisted=false}={}){let retryAt=0;return new Proxy(source,{get(target,name){const fn=target[name];if(typeof fn!=='function'||['close','refresh','saveNotes','link','rebuildLookup'].includes(name))return fn;return async(...args)=>{
  const failed=()=>{context.getStore()?.push('unavailable');return persisted?cachedRead(name,args):name==='get'?null:[];};
  if(clock()<retryAt)return failed();let timer;
  try{return await Promise.race([Promise.resolve().then(()=>fn(...args)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ORDER_DATABASE_UNAVAILABLE')),sourceTimeoutMs);})]);}
  catch(e){if(!unavailable(e))throw e;retryAt=clock()+15000;return failed();}finally{clearTimeout(timer);}
 };}});}
 primary=guarded(primary,{persisted:true});legacy=guarded(legacy);
 function cached(id){const row=db.prepare('SELECT data FROM order_source_cache WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
 function cachedRead(name,args){
  if(name==='get')return cached(args[0]);
  if(!['forCustomer','forEmails','search','findIdentifiers','findByKeys'].includes(name))return[];
  let emails=[],ids=[];
  if(name==='forCustomer'){const c=db.prepare('SELECT email FROM customers WHERE id=?').get(args[0]);emails=c?[c.email]:[];ids=db.prepare('SELECT order_id FROM external_order_links WHERE customer_id=?').all(args[0]).map(r=>r.order_id);}
  if(name==='forEmails'){emails=args[0];ids=(args[1]||[]).map(id=>'pg:'+id);}
  const normalized=new Set(emails.map(e=>String(e).toLowerCase()));
  const query=String(args[0]||'').toLowerCase(),tokens=new Set((name==='findIdentifiers'?args[0]:[]).map(v=>v.toLowerCase()));
  const results=[];for(const row of db.prepare('SELECT data FROM order_source_cache').iterate()){
   const o=JSON.parse(row.data),terms=[o.order_number,o.provider_id,...o.emails||[],o.customer_email,...(o.shipments||[]).map(s=>s.tracking_number)].filter(Boolean).map(v=>String(v).toLowerCase());
   const match=name==='forCustomer'||name==='forEmails'?ids.includes(o.id)||[o.customer_email,...o.emails||[]].some(e=>normalized.has(String(e).toLowerCase())):
    name==='search'?terms.some(t=>t.includes(query)):name==='findIdentifiers'?terms.some(t=>tokens.has(t)):
    args[0].some(k=>k.domain===o.shop_domain&&(k.provider===o.provider_id||k.number===String(o.order_number).toUpperCase()));
   if(match)results.push(o);
  }return results;
 }
 function remember(o){
  if(o.id.startsWith('pg:'))db.prepare('INSERT INTO order_source_cache VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE data<>excluded.data').run(o.id,JSON.stringify(o));
  else {const row=db.prepare("SELECT id,data FROM order_source_cache WHERE json_extract(data,'$.shop_domain')=? AND json_extract(data,'$.provider_id')=? LIMIT 1").get(o.shop_domain,o.provider_id);if(row){o.aliases=[...new Set([...o.aliases,row.id])];o.id=row.id;}}
  return o;
 }

 const links=()=>db.prepare('SELECT customer_id,order_id FROM external_order_links').all();
 function notes(o){remember(o);o.shop_name=shopDisplayName(db,o);for(const id of [...o.aliases.filter(id=>id!==o.id),o.id]){const r=db.prepare('SELECT notes FROM external_order_notes WHERE order_id=?').get(id);if(!r)continue;const n=JSON.parse(r.notes);Object.assign(o.local,n);for(const number of n.manualTracking||[])if(!o.shipments.some(s=>s.tracking_number.toUpperCase()===number.toUpperCase()))o.shipments.push({tracking_number:number,carrier:null,source:'manual'});}return o;}
 async function combine(p,l){const [extraL,extraP]=await Promise.all([p.length?legacy.byKeys(keys(p)):[],l.some(o=>!p.some(r=>r.shop_domain===o.shop_domain&&(r.provider_id===o.provider_id||String(r.order_number).toUpperCase()===String(o.order_number).toUpperCase())))?primary.findByKeys(keys(l.filter(o=>!p.some(r=>r.shop_domain===o.shop_domain&&(r.provider_id===o.provider_id||String(r.order_number).toUpperCase()===String(o.order_number).toUpperCase()))))):[]]);return mergeOrders([...p,...extraP],mergeOrders(l,extraL)).map(notes);}
 async function get(id){let rows;if(/^pg:[1-9]\d*$/.test(id)){const o=await primary.get(id)||cached(id);if(!o)throw Error(context.getStore()?.length?'ORDER_DATABASE_UNAVAILABLE':'ORDER_NOT_FOUND');rows=await combine([o],[]);}else if(/^cw:[a-f0-9]{64}$/.test(id)){const o=await legacy.get(id);if(!o)throw Error(context.getStore()?.length?'ORDER_DATABASE_UNAVAILABLE':'ORDER_NOT_FOUND');rows=await combine([],[o]);}else throw Error('ORDER_NOT_FOUND');return rows[0];}
 async function cachedMessageOrder(customerId){
  const {identifiers,normalize}=require('./order-association.cjs');
  const scopes=new Map();for(const r of db.prepare('SELECT inbox_id,shop_id FROM inbox_shops').all()){if(!scopes.has(r.inbox_id))scopes.set(r.inbox_id,new Set());scopes.get(r.inbox_id).add(r.shop_id);}
  const evidence=[];
  for(const m of db.prepare("SELECT subject,body_text,inbox_id FROM messages WHERE customer_id=? AND direction='inbound' ORDER BY sent_at DESC,id DESC").iterate(customerId)){
   const shops=scopes.get(m.inbox_id);if(!shops?.size)continue;
   const tokens=identifiers(m.subject,m.body_text);if(tokens.length)evidence.push({shops,tokens:new Set(tokens)});
  }
  if(!evidence.length)return[];
  const tokens=[...new Set(evidence.flatMap(e=>[...e.tokens]))],found=[];
  const failures=context.getStore()?.length||0;
  for(let i=0;i<tokens.length;i+=200){found.push(...await legacy.identifiers(tokens.slice(i,i+200)));if((context.getStore()?.length||0)>failures)throw Error('ORDER_DATABASE_UNAVAILABLE');}
  const rows=[...new Map(found.map(o=>[identity(o),o])).values()],direct=new Map(),related=new Set();
  for(const e of evidence)for(const o of rows){
   if(!e.shops.has(o.shop_id))continue;
   if([o.order_number,o.provider_id].some(v=>e.tokens.has(normalize(v)))){direct.set(identity(o),o);related.add(identity(o));}
   if((o.shipments||[]).some(s=>e.tokens.has(normalize(s.tracking_number))))related.add(identity(o));
  }
  // Historical mail is evidence, not a guessed mapping for an unavailable PG ID.
  // Conflicting orders/tracking or shops require manual confirmation.
  return direct.size===1&&related.size===1?await combine([],[...direct.values()]):[];
 }
 async function forCustomer(id){const customer=db.prepare('SELECT email FROM customers WHERE id=?').get(id);if(!customer)throw Error('CUSTOMER_NOT_FOUND');const linked=links().filter(r=>r.customer_id===id&&r.order_id.startsWith('cw:')).map(r=>r.order_id);const [p,l]=await Promise.all([primary.forCustomer(id),legacy.forEmails([customer.email],linked)]);let result=await combine(p,l);if(!result.length)result=await cachedMessageOrder(id);if(result.length>200)throw Error('ORDER_RESULT_LIMIT');return result;}
 async function matchIdentifiers(tokens){if(!tokens.length)return[];const wanted=new Set(tokens);const manual=db.prepare('SELECT order_id,notes FROM external_order_notes').all().filter(r=>(JSON.parse(r.notes).manualTracking||[]).some(n=>wanted.has(n.toUpperCase())));const [p,l,m]=await Promise.all([primary.findIdentifiers(tokens),legacy.identifiers(tokens),Promise.all(manual.map(r=>get(r.order_id)))]);const combined=await combine(p,l);return mergeOrders(combined,m).map(notes);}
 async function searchAll(term){const q=String(term||'').trim().slice(0,200);if(!q)return[];const manual=db.prepare('SELECT order_id,notes FROM external_order_notes').all().filter(r=>(JSON.parse(r.notes).manualTracking||[]).some(n=>n.toLowerCase().includes(q.toLowerCase()))).map(r=>r.order_id);const [p,l,m]=await Promise.all([primary.search(q),legacy.search(q,{exactOnly:true}),manual.length?Promise.all(manual.map(id=>get(id))):[]]);const exact=q.toLowerCase(),matched=l.length||p.some(o=>[o.order_number,o.provider_id,...o.emails||[],...(o.shipments||[]).map(s=>s.tracking_number)].some(v=>String(v||'').toLowerCase()===exact));const old=matched?l:await legacy.search(q);return combine(p,[...old,...m]);}
 async function loadShops(){const [old]=await Promise.all([legacy.shops(),primary.loadShops()]);for(const row of old){const id=shopId(row.store_subdomain);if(!db.prepare('SELECT 1 FROM shops WHERE id=?').get(id))store.addShop({id,domain:row.store_subdomain,name:row.store_name});}}
 async function link(input,actor){store.actor(actor);if(!db.prepare('SELECT id FROM customers WHERE id=?').get(input.customerId))throw Error('CUSTOMER_NOT_FOUND');if(input.messageId&&db.prepare('SELECT customer_id FROM messages WHERE id=?').get(input.messageId)?.customer_id!==input.customerId)throw Error('MESSAGE_CUSTOMER_MISMATCH');const o=await get(input.orderId);store.transaction(()=>{db.prepare('INSERT INTO external_order_links VALUES(?,?,?) ON CONFLICT(customer_id,order_id) DO UPDATE SET message_id=excluded.message_id').run(input.customerId,o.id,input.messageId||null);for(const alias of o.aliases||[])if(alias!==o.id&&/^cw:[a-f0-9]{64}$/.test(alias))db.prepare('INSERT INTO external_order_links VALUES(?,?,?) ON CONFLICT(customer_id,order_id) DO UPDATE SET message_id=excluded.message_id').run(input.customerId,alias,input.messageId||null);store.audit(actor,'order.link',o.id,{customerId:input.customerId,source:o.source});if(input.messageId&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='message_order_matches'").get()){db.prepare('DELETE FROM message_order_matches WHERE message_id=?').run(input.messageId);db.prepare('INSERT INTO message_order_matches VALUES(?,?)').run(input.messageId,o.id);db.prepare('DELETE FROM order_match_candidates WHERE message_id=?').run(input.messageId);}});}
 async function saveNotes(input,actor){store.actor(actor);const o=await get(input.orderId);const n=JSON.parse(db.prepare('SELECT notes FROM external_order_notes WHERE order_id=?').get(o.id)?.notes||'{}');for(const k of ['product','variant','recipient','phone','address'])if(input[k]!==undefined){if(typeof input[k]!=='string'||input[k].length>(k==='address'?2000:300))throw Error('INVALID_FIELD');n[k]=input[k].trim();}if(input.trackingNumber!==undefined){if(typeof input.trackingNumber!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{4,99}$/.test(input.trackingNumber.trim()))throw Error('INVALID_FIELD');n.manualTracking=[...new Set([...(n.manualTracking||[]),input.trackingNumber.trim().toUpperCase()])];}store.transaction(()=>{db.prepare('INSERT OR REPLACE INTO external_order_notes VALUES(?,?)').run(o.id,JSON.stringify(n));store.audit(actor,'order.local_note',o.id,{localOnly:true});});return{saved:true,localOnly:true};}
 function customersFor(orders){const emails=new Set(orders.flatMap(o=>o.emails||[o.customer_email])),ids=new Set(orders.flatMap(o=>o.aliases||[o.id])),linked=new Set(links().filter(r=>ids.has(r.order_id)).map(r=>r.customer_id));return db.prepare('SELECT id,email FROM customers').all().filter(c=>emails.has(c.email)||linked.has(c.id)).map(c=>c.id);}
 async function matchingCustomers(q,shopIds=null){if(shopIds)return customersFor((await searchAll(q)).filter(o=>shopIds.includes(o.shop_id)));const [p,orders]=await Promise.all([primary.matchingCustomers(q),searchAll(q)]);return [...new Set([...p,...customersFor(orders)])];}
 async function customersByOrderStatus(status,shopIds=null){if(!['shipped','waiting','unpaid'].includes(status))throw Error('INVALID_ORDER_STATUS');const emails=db.prepare('SELECT email FROM customers').all().map(c=>c.email),linked=links();const [p,l]=await Promise.all([primary.forEmails(emails,linked.filter(r=>r.order_id.startsWith('pg:')).map(r=>r.order_id.slice(3))),legacy.forEmails(emails,linked.filter(r=>r.order_id.startsWith('cw:')).map(r=>r.order_id))]);const all=await combine(p,l);return customersFor(all.filter(o=>(!shopIds||shopIds.includes(o.shop_id))&&!['closed','cancelled','canceled'].includes(o.order_status)&&(status==='shipped'?['shipped','partially_shipped','fulfilled','partially_fulfilled'].includes(o.fulfillment_status):status==='waiting'?o.financial_status==='paid'&&['waiting','initialled','unfulfilled'].includes(o.fulfillment_status):['waiting','pending','unpaid'].includes(o.financial_status))));}
 const service={rebuildLookup:()=>primary.rebuildLookup(),matchIdentifiers,refresh:(o,options)=>legacy.refresh(o,options),loadShops,get,forCustomer,search:async q=>(await searchAll(q)).slice(0,50),link,saveNotes,matchingCustomers,customersByOrderStatus,close:async()=>{await Promise.all([primary.close(),legacy.close()]);}};
 for(const name of ['get','forCustomer','search','matchIdentifiers','matchingCustomers','customersByOrderStatus','loadShops','link','saveNotes']){const fn=service[name];service[name]=(...args)=>context.run([],async()=>{const result=await fn(...args);if(Array.isArray(result)&&!result.length&&context.getStore().length)throw Error('ORDER_DATABASE_UNAVAILABLE');return result;});}
 return service;
}
module.exports={combinedOrders,mergeOrders};
