'use strict';
const table='public.support_order_snapshots';
const columns=`id::text,store_subdomain,order_id,order_number,customer_email,raw_order_json->'customer'->>'email' AS contact_email,shipping_address_json->>'email' AS shipping_email,raw_order_json->>'email' AS checkout_email,raw_order_json->'fulfillments' AS fulfillments`;
const normal=v=>String(v||'').trim().toLowerCase();
function createOrderLookup(read,{clock=Date.now,ttl=60000,fullInterval=600000}={}){
 let rows=null,pending=null,checkedAt=0,fullAt=0,high='0',closed=false;
 async function refresh(){if(pending)return pending;if(closed)throw Error('ORDER_LOOKUP_CLOSED');
  pending=(async()=>{const started=clock(),full=!rows||started-fullAt>=fullInterval;const data=await read(`SELECT ${columns} FROM ${table}`+(full?'':' WHERE id>$1::bigint OR updated_at>=$2::timestamptz OR fetched_at>=$2::timestamptz'),full?[]:[high,new Date(checkedAt-60000).toISOString()]);const next=full?new Map():new Map(rows);let newest=full?'0':high;
   for(const r of data){const id=String(r.id);const shipments=Array.isArray(r.fulfillments)?r.fulfillments:[];const emails=[...new Set([r.customer_email,r.contact_email,r.shipping_email,r.checkout_email].map(normal).filter(Boolean))];const numbers=[normal(r.order_number),normal(r.order_id)].filter(Boolean);const tracking=shipments.flatMap(f=>[f.tracking_number,...(Array.isArray(f.tracking_items)?f.tracking_items.map(t=>t.tracking_number):[])]).map(normal).filter(Boolean);next.set(id,{id,domain:r.store_subdomain,emails,numbers,tracking});if(BigInt(id)>BigInt(newest))newest=id;}
   rows=next;high=newest;checkedAt=started;if(full)fullAt=started;
  })();try{await pending;}finally{pending=null;}
 }
 async function ready(){if(!rows||clock()-checkedAt>=fullInterval)await refresh();else if(clock()-checkedAt>=ttl)refresh().catch(()=>{});return rows;}
 async function emails(values){const wanted=new Set(values.map(normal));return[...(await ready()).values()].filter(r=>r.emails.some(e=>wanted.has(e))).map(r=>r.id);}
 async function search(term){const q=normal(term);if(!q)return[];return[...(await ready()).values()].filter(r=>[...r.numbers,...r.emails,...r.tracking].some(v=>v.includes(q))).map(r=>r.id);}
 async function identifiers(values){const wanted=new Set(values.map(normal));return[...(await ready()).values()].filter(r=>[...r.numbers,...r.tracking].some(v=>wanted.has(v))).map(r=>r.id);}
 async function customers(term,manual=[]){const ids=new Set([...await search(term),...manual.map(String)]);return[...(await ready()).values()].filter(r=>ids.has(r.id));}
 return{emails,search,identifiers,customers,warm:ready,async close(){closed=true;if(pending)await pending.catch(()=>{});rows=null;}};
}
module.exports={createOrderLookup};
