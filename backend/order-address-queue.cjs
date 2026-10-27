'use strict';
const {Pool}=require('pg');
const fields=['first_name','last_name','phone','phone_area_code','country','country_code','province','province_code','area','city','address','address1','company','zip'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const requestColumns='id::text,store_subdomain,order_id,source,actor,status,error_code,error_message,before_address_json,desired_address_json,after_address_json,attempts,created_at,updated_at,completed_at';
const active="status IN ('pending','processing','uncertain')";
function options(c){if(!c?.host||!c.password||c.user!=='order_address_writer'||c.database!=='support_portal')throw Error('ADDRESS_QUEUE_CONFIG_REQUIRED');return {host:c.host,port:c.port||5432,database:c.database,user:c.user,password:c.password,application_name:'maildesk-order-address-writer',max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:15000,idle_in_transaction_session_timeout:15000,ssl:{rejectUnauthorized:false}};}
function validate(input){
 if(!object(input.patch)||!Object.keys(input.patch).length||Buffer.byteLength(JSON.stringify(input.patch))>16384||!object(input.expected)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.idempotencyKey||''))throw Error('invalid_address_payload');
 for(const [k,v]of Object.entries(input.patch))if(!fields.includes(k)||typeof v!=='string'||[...v].length>1000)throw Error('invalid_address_field');
}
function localAddress(a){return {recipient:[a.first_name,a.last_name].filter(Boolean).join(' ')||a.name||'',phone:[a.phone_area_code,a.phone].filter(Boolean).join(' '),address:[a.address,a.address1,a.city,a.province,a.zip,a.country||a.country_code].filter(Boolean).join(', ')};}
function createAddressQueue(credentials,{PoolImpl=Pool,onSuccess=async()=>{},audit=()=>{}}={}){
 const pool=new PoolImpl(options(credentials));pool.on('error',()=>{});
 async function query(sql,args=[]){try{return(await pool.query(sql,args)).rows;}catch(e){const known=['invalid_address_field','invalid_address_payload','invalid_request_identity','idempotency_key_reused','active_address_request_exists','store_unavailable','order_not_found'];const code=known.find(k=>String(e.message).includes(k));throw Error(code||'ADDRESS_QUEUE_UNAVAILABLE');}}
 async function identity(order){
  const domain=String(order.shop_domain||''),sub=domain.replace(/\.myshoplaza\.com$/i,'');
  const rows=await query('SELECT store_subdomain,order_id,order_number,shipping_address_json FROM public.support_order_snapshots WHERE store_subdomain IN ($1,$2) AND order_id=$3 ORDER BY updated_at DESC,id DESC LIMIT 1',[domain,sub,order.provider_id]);
  if(!rows.length)throw Error('order_not_found');return rows[0];
 }
 async function finish(order,r){
  if(!r)return null;r.id=String(r.id);
  if(r.status==='succeeded'&&object(r.after_address_json)){r.local=localAddress(r.after_address_json);try{await onSuccess(order,r,async()=>{const rows=await query('SELECT id::text FROM public.support_order_snapshots WHERE store_subdomain=$1 AND order_id=$2',[r.store_subdomain,r.order_id]);return rows.map(row=>'pg:'+row.id);});}catch{r.cachePending=true;}}
  return r;
 }
 async function read(order){const o=await identity(order),args=[o.store_subdomain,o.order_id];
  const rows=await query(`SELECT ${requestColumns} FROM public.support_shipping_address_requests WHERE store_subdomain=$1 AND order_id=$2 ORDER BY CASE WHEN ${active} THEN 0 ELSE 1 END,id DESC LIMIT 1`,args);
  return {address:o.shipping_address_json||{},request:await finish(order,rows[0]||null)};
 }
 async function status(order,id){if(!/^[1-9]\d*$/.test(id||''))throw Error('invalid_request_identity');const o=await identity(order);
  const rows=await query(`SELECT ${requestColumns} FROM public.support_shipping_address_requests WHERE id=$1::bigint AND store_subdomain=$2 AND order_id=$3`,[id,o.store_subdomain,o.order_id]);if(!rows.length)throw Error('order_not_found');return finish(order,rows[0]);
 }
 async function submit(order,input,actor){validate(input);if(typeof actor!=='string'||!actor)throw Error('invalid_request_identity');const o=await identity(order);const who='maildesk:'+actor;
  const rows=await query('SELECT public.support_submit_shipping_address_change($1::text,$2::text,$3::jsonb,$4::jsonb,$5::text,$6::text)::text AS request_id',[o.store_subdomain,o.order_id,JSON.stringify(input.patch),JSON.stringify(input.expected),who,input.idempotencyKey]);
  const id=String(rows[0].request_id);audit(actor,'order.address_request',order.id,{requestId:id});
  return status(order,id);
 }
 return {read,status,submit,close:()=>pool.end()};
}
module.exports={createAddressQueue,options,validate,localAddress,fields};
