'use strict';
const {Pool}=require('pg');

function connectionOptions(connectionString){
 if(!connectionString)throw Error('ORDER_DATABASE_URL_REQUIRED');
 let url;try{url=new URL(connectionString);}catch{throw Error('ORDER_DATABASE_URL_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('ORDER_DATABASE_URL_INVALID');
 const sslmode=url.searchParams.get('sslmode')||'verify-full';
 if(!['require','verify-ca','verify-full'].includes(sslmode))throw Error('ORDER_DATABASE_SSL_REQUIRED');
 url.searchParams.set('sslmode',sslmode);
 // Preserve libpq sslmode semantics: require encrypts, verify-full also verifies identity.
 url.searchParams.set('uselibpqcompat','true');
 url.searchParams.delete('options');
 return{connectionString:url.toString(),max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:300000,
  options:'-c default_transaction_read_only=on -c statement_timeout=10000',application_name:'maildesk-order-reader'};
}

function createOrderDatabase(connectionString,{PoolImpl=Pool}={}){
 const pool=new PoolImpl(connectionOptions(connectionString));
 // Idle connection errors must not crash the local mail service or print credentials.
 pool.on('error',()=>{});
 async function read(text,values=[]){
  // Each SELECT runs in PostgreSQL's implicit transaction with the connection's
  // default_transaction_read_only=on. Avoid two extra network round trips.
  if(!/^SELECT\s/i.test(text)||text.includes(';'))throw Error('ORDER_SELECT_REQUIRED');
  const client=await pool.connect();let discard=false;
  try{const result=await client.query(text,values);return result.rows;}
  catch(err){discard=true;throw err;}
  finally{client.release(discard);}
 }
 async function inspect(){
  const connection=await read("SELECT current_setting('transaction_read_only') AS read_only, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()");
  // Metadata only. Never select any remote mail/message rows.
  const columns=await read("SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name ~* '(order|shop|store|shipment|tracking|fulfillment)' ORDER BY table_schema,table_name,ordinal_position");
  return{connection:connection[0],columns};
 }
 const lookup=require('./order-lookup.cjs').createOrderLookup(read,{coldEmailLookup:async emails=>{
  if(!emails.length)return[];
  const rows=await read("SELECT id::text FROM public.support_order_snapshots WHERE lower(btrim(customer_email))=ANY($1::text[]) OR lower(btrim(raw_order_json->'customer'->>'email'))=ANY($1::text[]) OR lower(btrim(shipping_address_json->>'email'))=ANY($1::text[]) OR lower(btrim(raw_order_json->>'email'))=ANY($1::text[])",[emails]);
  return rows.map(r=>r.id);
 }});
 return{read,inspect,lookup,close:async()=>{await lookup.close();await pool.end();}};
}
module.exports={connectionOptions,createOrderDatabase};
