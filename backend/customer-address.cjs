'use strict';
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {validate}=require('./order-address-queue.cjs');
const hash=v=>createHash('sha256').update(String(v)).digest('hex');
const opaque=()=>randomBytes(32).toString('base64url');
const normalize=v=>String(v||'').trim().toLowerCase();
const publicRequest=r=>r?{id:String(r.id),status:r.status}:null;
const definiteErrors=new Set(['invalid_address_field','invalid_address_payload','invalid_request_identity','idempotency_key_reused','active_address_request_exists','store_unavailable','order_not_found','INVALID_ADDRESS','COUNTRY_CHANGE_UNAVAILABLE','ORDER_NOT_EDITABLE','ORDER_ADDRESS_WINDOW_EXPIRED','ORDER_ADDRESS_TIME_UNKNOWN']);
function editable(o){
 if(!['waiting','initialled','unfulfilled'].includes(o.fulfillment_status)||!['opened','placed','open','processing','pending'].includes(o.order_status))throw Error('ORDER_NOT_EDITABLE');
}
function createCustomerAddress({db,queue,stores,now=Date.now}){
 const inFlight=new Map();
 db.exec(`CREATE TABLE IF NOT EXISTS customer_address_sessions(digest TEXT PRIMARY KEY,context TEXT NOT NULL,expires INTEGER NOT NULL,expected TEXT,payload TEXT,request_key TEXT,request_id TEXT);
 CREATE TABLE IF NOT EXISTS customer_address_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_address_requests(owner TEXT PRIMARY KEY,request_key TEXT NOT NULL,payload TEXT NOT NULL,expected TEXT NOT NULL,request_id TEXT);`);
 const owner=s=>hash(s.context.store+':'+s.context.providerId+':'+s.context.email);
 function limit(key,max,ms){const k=hash(key),r=db.prepare('SELECT * FROM customer_address_limits WHERE key=?').get(k);if(r&&r.until>now()&&r.count>=max)throw Error('RATE_LIMITED');db.prepare('INSERT OR REPLACE INTO customer_address_limits VALUES(?,?,?)').run(k,r&&r.until>now()?r.count+1:1,r&&r.until>now()?r.until:now()+ms);}
 function session(token){if(typeof token!=='string'||token.length>100)throw Error('VERIFICATION_REQUIRED');const r=db.prepare('SELECT * FROM customer_address_sessions WHERE digest=? AND expires>?').get(hash(token),now());if(!r)throw Error('VERIFICATION_REQUIRED');return {...r,context:JSON.parse(r.context)};}
 async function identity(s){limit('session:'+s.digest,120,60000);const c=s.context,store=Object.hasOwn(stores,c.store)&&stores[c.store];if(!store)throw Error('VERIFICATION_REQUIRED');const o=await queue.customerIdentity(store.subdomain,c.order);if(!o||o.provider_id!==c.providerId||normalize(o.customer_email)!==c.email)throw Error('VERIFICATION_REQUIRED');return o;}
 async function lookup(input,ip){
  for(const [table,column]of [['customer_address_sessions','expires'],['customer_address_limits','until']])db.prepare(`DELETE FROM ${table} WHERE ${column}<=?`).run(now());
  limit('lookup-ip:'+ip,60,3600000);
  const store=Object.hasOwn(stores,input?.store)&&stores[input.store],ref=String(input?.order||'').trim(),email=normalize(input?.email);
  if(!store||!ref||ref.length>100||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||email.length>254)throw Error('ORDER_LOOKUP_FAILED');
  limit('lookup-order:'+input.store+':'+ref,20,3600000);limit('lookup-email:'+email,30,3600000);
  const order=await queue.customerIdentity(store.subdomain,ref);
  if(!order||normalize(order.customer_email)!==email)throw Error('ORDER_LOOKUP_FAILED');
  const context=JSON.stringify({store:input.store,order:ref,providerId:order.provider_id,email}),token=opaque();
  db.prepare('INSERT INTO customer_address_sessions(digest,context,expires) VALUES(?,?,?)').run(hash(token),context,now()+1800000);
  return {token,expiresIn:1800};
 }
 async function read(token){const s=session(token),o=await identity(s),r=await queue.read(o);let allowed=r.eligibility.allowed,error=r.eligibility.error;try{editable(o);}catch(e){allowed=false;error=e.message;}
  const saved=db.prepare('SELECT * FROM customer_address_requests WHERE owner=?').get(owner(s));
  if(saved){const request=saved.request_id?publicRequest(await queue.status(o,saved.request_id)):null;
   if(!request||['pending','processing','uncertain'].includes(request.status)){
    db.prepare('UPDATE customer_address_sessions SET expected=?,payload=?,request_key=?,request_id=? WHERE digest=?').run(saved.expected,saved.payload,saved.request_key,saved.request_id,s.digest);
    return {address:r.address,eligibility:{...r.eligibility,allowed:false},request,resumePatch:request?null:JSON.parse(saved.payload)};
   }
   db.prepare('DELETE FROM customer_address_requests WHERE owner=? AND request_key=?').run(owner(s),saved.request_key);
  }
  if(!s.payload)db.prepare('UPDATE customer_address_sessions SET expected=? WHERE digest=? AND payload IS NULL').run(JSON.stringify(r.address),s.digest);
  return {address:r.address,eligibility:{...r.eligibility,allowed,error},request:s.request_id?publicRequest(await queue.status(o,s.request_id)):null};
 }
 async function submit(token,input){
  const initial=session(token),o=await identity(initial);
  // Re-read after awaits: concurrent submits must use the same server-owned UUID and payload.
  const s=session(token);if(!s.expected)throw Error('READ_ADDRESS_FIRST');
  const patch=input?.patch;if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('INVALID_ADDRESS');
  const payload=JSON.stringify(Object.fromEntries(Object.entries(patch).sort(([a],[b])=>a.localeCompare(b))));
  if(s.payload&&s.payload!==payload)throw Error('REQUEST_ALREADY_SUBMITTED');
  const expected=JSON.parse(s.expected),key=s.request_key||randomUUID();validate({patch,expected,idempotencyKey:key});
  require('./public/customer-address/form-model.js').validatePatch(expected,patch);
  const merged={...expected,...patch};if(!['first_name','address','city'].every(k=>String(merged[k]||'').trim())||!merged.country_code)throw Error('INVALID_ADDRESS');
  if(Object.hasOwn(patch,'province')&&patch.province!==expected.province&&!Object.hasOwn(patch,'province_code'))throw Error('INVALID_ADDRESS');
  if(!s.payload){editable(o);const latest=await queue.read(o);if(!latest.eligibility.allowed)throw Error(latest.eligibility.error);
   const current=session(token);if(current.payload)return submit(token,input);
   const saved=db.prepare('SELECT * FROM customer_address_requests WHERE owner=?').get(owner(s));
   if(saved){if(saved.payload!==payload)throw Error('REQUEST_ALREADY_SUBMITTED');db.prepare('UPDATE customer_address_sessions SET expected=?,payload=?,request_key=?,request_id=? WHERE digest=?').run(saved.expected,saved.payload,saved.request_key,saved.request_id,s.digest);return submit(token,input);}
   db.prepare('INSERT INTO customer_address_requests(owner,request_key,payload,expected) VALUES(?,?,?,?)').run(owner(s),key,payload,s.expected);
   db.prepare('UPDATE customer_address_sessions SET payload=?,request_key=? WHERE digest=? AND payload IS NULL').run(payload,key,s.digest);
  }
  let work=inFlight.get(key);if(!work){work=queue.submit(o,{patch,expected,idempotencyKey:key},'customer:'+hash(s.context.store+':'+s.context.email).slice(0,32));inFlight.set(key,work);}
  let r;try{r=await work;}catch(e){if(definiteErrors.has(e.message)){
   db.prepare('DELETE FROM customer_address_requests WHERE owner=? AND request_key=? AND request_id IS NULL').run(owner(s),key);
   db.prepare('UPDATE customer_address_sessions SET payload=NULL,request_key=NULL WHERE request_key=? AND request_id IS NULL').run(key);
  }throw e;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
  db.prepare('UPDATE customer_address_sessions SET request_id=? WHERE digest=?').run(String(r.id),s.digest);
  db.prepare('UPDATE customer_address_requests SET request_id=? WHERE owner=? AND request_key=?').run(String(r.id),owner(s),key);return publicRequest(r);
 }
 async function status(token,id){const s=session(token);if(!s.request_id||s.request_id!==String(id))throw Error('REQUEST_NOT_FOUND');return publicRequest(await queue.status(await identity(s),s.request_id));}
 return {lookup,read,submit,status};
}
module.exports={createCustomerAddress,definiteErrors};
