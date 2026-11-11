'use strict';
// This connection only reads the shared address queue; it cannot submit changes.
function createReader(credentials){
 const {Pool}=require('pg');
 const options=require('./order-address-queue.cjs').options(credentials);
 const pool=new Pool({...options,max:1,statement_timeout:5000,options:'-c default_transaction_read_only=on'});
 pool.on('error',()=>{});
 async function fetchSuccesses(){
  const client=await pool.connect();
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await client.query("SET LOCAL statement_timeout='5s'");
   const result=[];let cursor='0';
   for(;;){
    const {rows}=await client.query(`SELECT r.id::text,r.store_subdomain,r.order_id,r.actor,r.status,r.completed_at,r.before_address_json,r.after_address_json,s.order_number
     FROM public.support_shipping_address_requests r LEFT JOIN LATERAL
     (SELECT order_number FROM public.support_order_snapshots s WHERE s.order_id=r.order_id AND s.store_subdomain=r.store_subdomain ORDER BY updated_at DESC,id DESC LIMIT 1) s ON true
     WHERE r.status='succeeded' AND r.id>$1::bigint ORDER BY r.id LIMIT 500`,[cursor]);
    result.push(...rows);if(rows.length<500)break;cursor=rows.at(-1).id;
   }
   await client.query('ROLLBACK');return result;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw Error('MABANG_SOURCE_UNAVAILABLE');}finally{client.release();}
 }
 return {fetchSuccesses,close:()=>pool.end()};
}
module.exports={createReader};
