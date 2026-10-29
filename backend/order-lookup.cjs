'use strict';
const table='public.support_order_snapshots';
const columns=`id::text,store_subdomain,order_id,order_number,customer_email,raw_order_json->'customer'->>'email' AS contact_email,shipping_address_json->>'email' AS shipping_email,raw_order_json->>'email' AS checkout_email,raw_order_json->'fulfillments' AS fulfillments`;
const normal=v=>String(v||'').trim().toLowerCase();
function createOrderLookup(read,{clock=Date.now,ttl=60000,fullInterval=21600000,maxStale=Math.min(fullInterval,600000),pageSize=500,coldEmailLookup=null}={}){
 let rows=null,pending=null,checkedAt=0,fullAt=0,high='0',closed=false,emailIndex=new Map();
 async function refresh(force=false){if(pending){await pending;if(!force)return;}if(closed)throw Error('ORDER_LOOKUP_CLOSED');
  pending=(async()=>{const started=clock(),full=force||!rows||started-fullAt>=fullInterval;const data=[];let cursor='0';
   for(;;){if(closed)throw Error('ORDER_LOOKUP_CLOSED');const page=await read(`SELECT ${columns} FROM ${table} WHERE id>$1::bigint`+(full?'':' AND (id>$3::bigint OR updated_at>=$4::timestamptz OR fetched_at>=$4::timestamptz)')+' ORDER BY id LIMIT $2',full?[cursor,pageSize]:[cursor,pageSize,high,new Date(checkedAt-60000).toISOString()]);data.push(...page);if(page.length<pageSize)break;const last=page[page.length-1].id;if(BigInt(last)<=BigInt(cursor))throw Error('ORDER_LOOKUP_PAGE_INVALID');cursor=String(last);}
   const next=full?new Map():new Map(rows);let newest=full?'0':high;
   for(const r of data){const id=String(r.id);const shipments=Array.isArray(r.fulfillments)?r.fulfillments:[];const emails=[...new Set([r.customer_email,r.contact_email,r.shipping_email,r.checkout_email].map(normal).filter(Boolean))];const numbers=[normal(r.order_number),normal(r.order_id)].filter(Boolean);const tracking=require('./order-shipments.cjs').orderShipments(shipments).map(s=>normal(s.tracking_number));next.set(id,{id,domain:r.store_subdomain,emails,numbers,tracking});if(BigInt(id)>BigInt(newest))newest=id;}
   const nextEmails=full?new Map():emailIndex;for(const r of data){const id=String(r.id);if(!full)for(const e of rows.get(id)?.emails||[]){const set=nextEmails.get(e);set?.delete(id);if(!set?.size)nextEmails.delete(e);}for(const e of next.get(id).emails){if(!nextEmails.has(e))nextEmails.set(e,new Set());nextEmails.get(e).add(id);}}emailIndex=nextEmails;rows=next;high=newest;checkedAt=started;if(full)fullAt=started;
  })();try{await pending;}finally{pending=null;}
 }
 async function ready(){if(!rows||clock()-checkedAt>=maxStale)await refresh();else if(clock()-checkedAt>=ttl)refresh().catch(()=>{});return rows;}
 async function emails(values){if(!rows&&coldEmailLookup){void ready().catch(()=>{});return coldEmailLookup(values.map(normal));}await ready();const ids=new Set();for(const e of values.map(normal))for(const id of emailIndex.get(e)||[])ids.add(id);return [...ids];}
 async function search(term){const q=normal(term);if(!q)return[];return[...(await ready()).values()].filter(r=>[...r.numbers,...r.emails,...r.tracking].some(v=>v.includes(q))).map(r=>r.id);}
 async function identifiers(values){const wanted=new Set(values.map(normal));return[...(await ready()).values()].filter(r=>[...r.numbers,...r.tracking].some(v=>wanted.has(v))).map(r=>r.id);}
 async function customers(term,manual=[]){const ids=new Set([...await search(term),...manual.map(String)]);return[...(await ready()).values()].filter(r=>ids.has(r.id));}
 return{emails,search,identifiers,customers,warm:ready,refreshAll:()=>refresh(true),async close(){closed=true;if(pending)await pending.catch(()=>{});rows=null;emailIndex.clear();}};
}
module.exports={createOrderLookup};
