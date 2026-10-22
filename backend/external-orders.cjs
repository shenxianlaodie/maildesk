'use strict';
const {idFor}=require('./database.cjs');
const {virtualProgress}=require('./virtual-progress.cjs');
const shopId=domain=>idFor('postgres-shop',domain);
const fields=`id::text,store_subdomain,store_name,order_id,order_number,customer_email,
 raw_order_json->'customer'->>'email' AS contact_email,shipping_address_json->>'email' AS shipping_email,raw_order_json->>'email' AS checkout_email,
 order_status,fulfillment_status,order_amount,order_currency,payment_status,payment_method,paid_at,
 refund_amount,items_json,shipping_address_json,fetched_at,updated_at,
 raw_order_json->>'financial_status' AS progress_financial_status,raw_order_json->>'fulfillment_status' AS progress_fulfillment_status,
 raw_order_json->>'id' AS progress_order_id,raw_order_json->'order_info'->>'placed_at' AS progress_placed_at,raw_order_json->'order_info'->>'created_at' AS progress_created_at,
 raw_order_json->>'placed_at' AS placed_at,raw_order_json->>'created_at' AS ordered_at,
 raw_order_json->>'total_paid' AS total_paid,raw_order_json->>'sub_total' AS subtotal,
 raw_order_json->>'total_refund_price' AS total_refund_price,raw_order_json->>'total_shipping' AS shipping,raw_order_json->'fulfillments' AS fulfillments`;
const table='public.support_order_snapshots';
const searchWhere=`WHERE order_number ILIKE $1 OR customer_email ILIKE $1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw_order_json->'fulfillments')='array' THEN raw_order_json->'fulfillments' ELSE '[]'::jsonb END) f WHERE f->>'tracking_number' ILIKE $1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f->'tracking_items')='array' THEN f->'tracking_items' ELSE '[]'::jsonb END) t WHERE t->>'tracking_number' ILIKE $1))`;
const date=v=>v?new Date(v).toISOString():null;
const amount=v=>v!=null&&/^\d+(\.\d+)?$/.test(String(v))?String(v):null;
function mapOrder(row){
 const address=row.shipping_address_json||{},items=Array.isArray(row.items_json)?row.items_json:[];
 const fulfillments=Array.isArray(row.fulfillments)?row.fulfillments:[];
 const shipments=fulfillments.flatMap(f=>[...(f.tracking_number?[f]:[]),...(Array.isArray(f.tracking_items)?f.tracking_items:[])]).filter(t=>t.tracking_number).map(t=>({tracking_number:String(t.tracking_number),carrier:t.tracking_company||null}));
 return{id:'pg:'+row.id,shop_id:shopId(row.store_subdomain),shop_name:row.store_name||row.store_subdomain,shop_domain:row.store_subdomain,
  shipped_at:fulfillments.filter(f=>['shipped','finished','delivered','fulfilled'].includes(f.status)).map(f=>f.created_at).filter(v=>v&&Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||null,provider_id:row.order_id,order_number:row.order_number,customer_email:row.customer_email,emails:[...new Set([row.customer_email,row.contact_email,row.shipping_email,row.checkout_email].map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))],
  currency:row.order_currency||'',total_amount:amount(row.order_amount),paid_amount:amount(row.total_paid),refunded_amount:amount(row.refund_amount)??amount(row.total_refund_price),payment_method:row.payment_method,
  financial_status:row.payment_status||'unknown',fulfillment_status:row.fulfillment_status||'unknown',order_status:row.order_status,
  placed_at:date(row.placed_at||row.ordered_at||row.paid_at),provider_updated_at:date(row.updated_at),synced_at:date(row.fetched_at),source:'postgresql',
  local:{product:items.map(i=>i.product_title||'').filter(Boolean).join(' / '),variant:items.map(i=>i.variant_title||'').filter(Boolean).join(' / '),quantity:items.reduce((n,i)=>n+(Number(i.quantity)||0),0),subtotal:amount(row.subtotal),shipping:amount(row.shipping),
   recipient:address.name||[address.first_name,address.last_name].filter(Boolean).join(' '),phone:address.phone||'',address:[address.address1||address.address,address.address2,address.city,address.province,address.zip,address.country].filter(Boolean).join(', ')},shipments,tracking:[],virtualProgress:virtualProgress(row)};
}
function namedShop(value){const name=String(value||'').trim();return name&&!/^(?:https?:\/\/)?[a-z0-9-]+\.myshoplaza\.com\/?$/i.test(name)&&name!=='店铺名称待补充'?name:'';}
function shopDisplayName(db,order){const shop=db.prepare('SELECT name FROM shops WHERE id=? OR domain=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1').get(order.shop_id,order.shop_domain,order.shop_id);return namedShop(shop?.name)||namedShop(order.shop_name)||'店铺名称待补充';}
function externalOrders(store,database,{clock=Date.now}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS external_order_links(customer_id TEXT NOT NULL REFERENCES customers(id),order_id TEXT NOT NULL,message_id TEXT REFERENCES messages(id),PRIMARY KEY(customer_id,order_id));
 CREATE TABLE IF NOT EXISTS external_order_notes(order_id TEXT PRIMARY KEY,notes TEXT NOT NULL);`);
 async function query(sql,args=[]){try{return await database.read(sql,args);}catch{throw Error('ORDER_DATABASE_UNAVAILABLE');}}
 function decorate(row){const order=mapOrder(row);order.shop_name=shopDisplayName(db,order);const notes=db.prepare('SELECT notes FROM external_order_notes WHERE order_id=?').get(order.id);if(notes){const saved=JSON.parse(notes.notes);Object.assign(order.local,saved);for(const tracking_number of saved.manualTracking||[])if(!order.shipments.some(s=>s.tracking_number.toUpperCase()===tracking_number.toUpperCase()))order.shipments.push({tracking_number,carrier:null,source:'manual'});}return order;}
 let shopsExpires=0,shopsLoading=null;
 async function loadShops(){database.lookup?.warm().catch(()=>{});if(clock()<shopsExpires)return;if(shopsLoading)return shopsLoading;shopsLoading=(async()=>{const rows=await query(`SELECT DISTINCT store_subdomain,store_name FROM ${table}`);const byDomain=new Map();for(const row of rows){const previous=byDomain.get(row.store_subdomain);if(!previous||(!namedShop(previous.store_name)&&namedShop(row.store_name)))byDomain.set(row.store_subdomain,row);}for(const row of byDomain.values()){const id=shopId(row.store_subdomain),saved=db.prepare('SELECT name FROM shops WHERE id=?').get(id);store.addShop({id,domain:row.store_subdomain,name:namedShop(row.store_name)||namedShop(saved?.name)||'店铺名称待补充'});}shopsExpires=clock()+300000;})();try{await shopsLoading;}finally{shopsLoading=null;}}
 function remoteId(id){if(!/^pg:[1-9]\d*$/.test(id||''))throw Error('ORDER_NOT_FOUND');return id.slice(3);}
 async function get(id){const rows=await query(`SELECT ${fields} FROM ${table} WHERE id=$1`,[remoteId(id)]);if(!rows[0])throw Error('ORDER_NOT_FOUND');return decorate(rows[0]);}
 async function forCustomer(customerId){const customer=db.prepare('SELECT email FROM customers WHERE id=?').get(customerId);if(!customer)throw Error('CUSTOMER_NOT_FOUND');
  const linked=db.prepare('SELECT order_id FROM external_order_links WHERE customer_id=?').all(customerId).filter(r=>String(r.order_id).startsWith('pg:')).map(r=>remoteId(r.order_id));
  if(database.lookup){const ids=[...new Set([...await database.lookup.emails([customer.email]),...linked])];const rows=ids.length?await query(`SELECT ${fields} FROM ${table} WHERE id=ANY($1::bigint[]) ORDER BY paid_at DESC NULLS LAST,id DESC LIMIT 201`,[ids]):[];if(rows.length>200)throw Error('ORDER_RESULT_LIMIT');return rows.map(decorate);}
  const rows=await query(`SELECT ${fields} FROM ${table} WHERE (lower(customer_email)=$1 OR lower(btrim(raw_order_json->'customer'->>'email'))=$1 OR lower(btrim(shipping_address_json->>'email'))=$1 OR lower(btrim(raw_order_json->>'email'))=$1) OR id=ANY($2::bigint[]) ORDER BY paid_at DESC NULLS LAST,id DESC LIMIT 201`,[customer.email,linked]);
  if(rows.length>200)throw Error('ORDER_RESULT_LIMIT');return rows.map(decorate);
 }
 function manualMatches(term){const q=String(term||'').trim().toUpperCase();if(!q)return[];return db.prepare('SELECT order_id,notes FROM external_order_notes').all().filter(r=>(JSON.parse(r.notes).manualTracking||[]).some(n=>n.toUpperCase().includes(q))).filter(r=>String(r.order_id).startsWith('pg:')).map(r=>remoteId(r.order_id));}
 async function search(term){const q=String(term||'').trim().slice(0,200);if(!q)return[];const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  if(database.lookup){const ids=[...new Set([...await database.lookup.search(q),...manualMatches(q)])];return(ids.length?await query(`SELECT ${fields} FROM ${table} WHERE id=ANY($1::bigint[]) ORDER BY paid_at DESC NULLS LAST,id DESC LIMIT 50`,[ids]):[]).map(decorate);}
  return(await query(`SELECT ${fields} FROM ${table} ${searchWhere} OR id=ANY($2::bigint[]) ORDER BY paid_at DESC NULLS LAST,id DESC LIMIT 50`,[pattern,manualMatches(q)])).map(decorate);
 }
 async function link(input,actor){store.actor(actor);if(!db.prepare('SELECT id FROM customers WHERE id=?').get(input.customerId))throw Error('CUSTOMER_NOT_FOUND');if(input.messageId&&db.prepare('SELECT customer_id FROM messages WHERE id=?').get(input.messageId)?.customer_id!==input.customerId)throw Error('MESSAGE_CUSTOMER_MISMATCH');await get(input.orderId);
  store.transaction(()=>{db.prepare('INSERT INTO external_order_links VALUES(?,?,?) ON CONFLICT(customer_id,order_id) DO UPDATE SET message_id=excluded.message_id').run(input.customerId,input.orderId,input.messageId||null);store.audit(actor,'order.link',input.orderId,{customerId:input.customerId,source:'postgresql'});});
 }
 async function saveNotes(input,actor){store.actor(actor);await get(input.orderId);const notes=JSON.parse(db.prepare('SELECT notes FROM external_order_notes WHERE order_id=?').get(input.orderId)?.notes||'{}');for(const k of ['product','variant','recipient','phone','address'])if(input[k]!==undefined){if(typeof input[k]!=='string'||input[k].length>(k==='address'?2000:300))throw Error('INVALID_FIELD');notes[k]=input[k].trim();}
  if(input.trackingNumber!==undefined){if(typeof input.trackingNumber!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]{4,99}$/.test(input.trackingNumber.trim()))throw Error('INVALID_FIELD');const n=input.trackingNumber.trim().toUpperCase();notes.manualTracking=[...new Set([...(notes.manualTracking||[]),n])];}
  store.transaction(()=>{db.prepare('INSERT OR REPLACE INTO external_order_notes VALUES(?,?)').run(input.orderId,JSON.stringify(notes));store.audit(actor,'order.local_note',input.orderId,{localOnly:true});});return{saved:true,localOnly:true};
 }
 async function matchingCustomers(term){if(database.lookup){const refs=await database.lookup.customers(term,manualMatches(term)),emails=new Set(refs.flatMap(r=>r.emails)),ids=new Set(refs.map(r=>'pg:'+r.id));const linked=new Set(db.prepare('SELECT customer_id,order_id FROM external_order_links').all().filter(r=>ids.has(r.order_id)).map(r=>r.customer_id));return db.prepare('SELECT id,email FROM customers').all().filter(r=>emails.has(r.email)||linked.has(r.id)).map(r=>r.id);}const pattern='%'+String(term).trim().slice(0,200).replace(/[\\%_]/g,'\\$&')+'%';const refs=await query(`SELECT id::text,customer_email FROM ${table} ${searchWhere} OR id=ANY($2::bigint[])`,[pattern,manualMatches(term)]);const emails=JSON.stringify([...new Set(refs.map(r=>String(r.customer_email||'').toLowerCase()))]),ids=JSON.stringify(refs.map(r=>'pg:'+r.id));return db.prepare('SELECT id FROM customers WHERE email IN(SELECT value FROM json_each(?)) OR id IN(SELECT customer_id FROM external_order_links WHERE order_id IN(SELECT value FROM json_each(?)))').all(emails,ids).map(r=>r.id);}
 async function customersByOrderStatus(status){
  const conditions={shipped:"fulfillment_status IN ('shipped','partially_shipped','fulfilled','partially_fulfilled')",waiting:"payment_status='paid' AND fulfillment_status IN ('waiting','initialled','unfulfilled')",unpaid:"payment_status IN ('waiting','pending','unpaid')"};
  if(!Object.hasOwn(conditions,status))throw Error('INVALID_ORDER_STATUS');
  const emails=db.prepare('SELECT email FROM customers').all().map(r=>r.email),links=db.prepare('SELECT customer_id,order_id FROM external_order_links').all();
  const refs=await query(`SELECT id::text,customer_email FROM ${table} WHERE (lower(customer_email)=ANY($1::text[]) OR id=ANY($2::bigint[])) AND COALESCE(order_status,'') NOT IN ('cancelled','canceled','closed') AND ${conditions[status]}`,[emails,links.filter(r=>String(r.order_id).startsWith('pg:')).map(r=>remoteId(r.order_id))]);
  const matchedEmails=new Set(refs.map(r=>String(r.customer_email||'').toLowerCase())),matchedIds=new Set(refs.map(r=>'pg:'+r.id));const linked=new Set(links.filter(r=>matchedIds.has(r.order_id)).map(r=>r.customer_id));
  return db.prepare('SELECT id,email FROM customers').all().filter(r=>matchedEmails.has(r.email)||linked.has(r.id)).map(r=>r.id);
 }
 async function findByKeys(keys){if(!keys.length)return[];const rows=await query(`SELECT ${fields} FROM ${table} WHERE order_id=ANY($1::text[]) OR order_number=ANY($2::text[])`,[keys.map(k=>k.provider),keys.map(k=>k.number)]);return rows.filter(r=>keys.some(k=>r.store_subdomain===k.domain&&(r.order_id===k.provider||String(r.order_number).toUpperCase()===k.number))).map(decorate);}
 async function forEmails(emails,ids){if(database.lookup){const selected=[...new Set([...await database.lookup.emails(emails),...ids.map(String)])];return(selected.length?await query(`SELECT ${fields} FROM ${table} WHERE id=ANY($1::bigint[])`,[selected]):[]).map(decorate);}return(await query(`SELECT ${fields} FROM ${table} WHERE (lower(customer_email)=ANY($1::text[]) OR lower(btrim(raw_order_json->'customer'->>'email'))=ANY($1::text[]) OR lower(btrim(shipping_address_json->>'email'))=ANY($1::text[]) OR lower(btrim(raw_order_json->>'email'))=ANY($1::text[])) OR id=ANY($2::bigint[])`,[emails,ids])).map(decorate);}
 async function findIdentifiers(tokens){if(!tokens.length)return[];if(database.lookup){const ids=await database.lookup.identifiers(tokens);return(ids.length?await query(`SELECT ${fields} FROM ${table} WHERE id=ANY($1::bigint[])`,[ids]):[]).map(decorate);}return(await query(`SELECT ${fields} FROM ${table} WHERE upper(order_number)=ANY($1::text[]) OR upper(order_id)=ANY($1::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw_order_json->'fulfillments')='array' THEN raw_order_json->'fulfillments' ELSE '[]'::jsonb END) f WHERE upper(f->>'tracking_number')=ANY($1::text[]) OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f->'tracking_items')='array' THEN f->'tracking_items' ELSE '[]'::jsonb END) t WHERE upper(t->>'tracking_number')=ANY($1::text[])))`,[tokens])).map(decorate);}
 return{findIdentifiers,findByKeys,forEmails,loadShops,forCustomer,search,get,link,saveNotes,matchingCustomers,customersByOrderStatus,close:()=>database.close()};
}
module.exports={externalOrders,mapOrder,shopId,shopDisplayName};
