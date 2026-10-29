'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createOrderLookup}=require('../backend/order-lookup.cjs');
const row={id:'1',store_subdomain:'shop.myshoplaza.com',order_number:'ORDER123',order_id:'prefix-ORDER123',customer_email:'A@EXAMPLE.COM',contact_email:'contact@example.com',shipping_email:'delivery@example.com',fulfillments:[{tracking_number:'TRACK123',tracking_items:[{tracking_number:'NESTED456'}]}]};
test('customer lookup does not wait for a cold full index and later uses the warmed index',async()=>{
 let release,direct=0;const gate=new Promise(r=>release=r);
 const index=createOrderLookup(async()=>{await gate;return[row];},{coldEmailLookup:async emails=>{direct++;assert.deepEqual(emails,['a@example.com']);return['1'];}});
 assert.deepEqual(await index.emails([' A@EXAMPLE.COM ']),['1']);release();await index.warm();assert.deepEqual(await index.emails(['a@example.com']),['1']);assert.equal(direct,1);await index.close();
});
test('cold index uses bounded keyset pages and retries completely after a failed page',async()=>{
 let fail=true;const cursors=[];
 const index=createOrderLookup(async(sql,args)=>{assert.match(sql,/ORDER BY id LIMIT \$2/);cursors.push(args[0]);if(args[0]==='0')return[{...row},{...row,id:'2'}];if(fail)throw Error('timeout');return[{...row,id:'3'}];},{pageSize:2});
 await assert.rejects(index.warm(),/timeout/);fail=false;assert.deepEqual(await index.emails(['a@example.com']),['1','2','3']);assert.deepEqual(cursors,['0','2','0','2']);await index.close();
});
test('one shared index supports every email and both tracking formats without duplicate remote scans',async()=>{let calls=0,release;const gate=new Promise(r=>release=r);const index=createOrderLookup(async()=>{calls++;await gate;return[row];});const requests=[index.emails(['contact@example.com']),index.search('ORDER'),index.identifiers(['nested456'])];release();assert.deepEqual(await Promise.all(requests),[['1'],['1'],['1']]);assert.equal(calls,1);assert.deepEqual(await index.emails(['DELIVERY@example.com']),['1']);assert.deepEqual(await index.search('%'),[]);assert.equal(calls,1);await index.close();});
test('refresh incorporates new and changed records; periodic full refresh removes deleted rows',async()=>{let now=100000,calls=[];let data=[row];const index=createOrderLookup(async(sql,args)=>{calls.push({sql,args});return data;},{clock:()=>now,ttl:10,fullInterval:100});await index.warm();now+=11;data=[{...row,customer_email:'new@example.com'},{...row,id:'2',order_number:'NEW789'}];await index.warm();await new Promise(r=>setImmediate(r));assert.deepEqual(await index.emails(['a@example.com']),['2']);assert.deepEqual(await index.identifiers(['NEW789']),['2']);assert.match(calls[1].sql,/updated_at>=/);assert.equal(calls[1].args[2],'1');now+=101;data=[];assert.deepEqual(await index.search('ORDER'),[]);assert.ok(!calls[2].sql.includes('updated_at>='));await index.close();});
test('failed initialization is retryable and stale index is not served indefinitely',async()=>{let fail=true,now=1000;const index=createOrderLookup(async()=>{if(fail)throw Error('offline');return[row];},{clock:()=>now,ttl:10,fullInterval:100});await assert.rejects(index.warm(),/offline/);fail=false;await index.warm();fail=true;now+=101;await assert.rejects(index.search('ORDER'),/offline/);await index.close();});

test('incremental watermarks use successful start time with overlap, never failed or completion time',async()=>{
 let now=100000,fail=false;const calls=[];const index=createOrderLookup(async(sql,args)=>{calls.push({sql,args});if(fail)throw Error('offline');now+=5000;return[row];},{clock:()=>now,ttl:10,fullInterval:1000000,maxStale:10});
 await index.warm();now=120000;fail=true;await assert.rejects(index.warm());now=140000;fail=false;await index.warm();assert.equal(calls[1].args[3],new Date(40000).toISOString());assert.equal(calls[2].args[3],new Date(40000).toISOString());now=160000;await index.warm();assert.equal(calls[3].args[3],new Date(80000).toISOString());await index.close();
});
test('reverse email index covers all four fields and forced rebuild removes deleted rows',async()=>{
 let rows=[{...row,checkout_email:' CHECKOUT@example.com '}],now=1000;const index=createOrderLookup(async()=>rows,{clock:()=>now,ttl:10,fullInterval:1000000,maxStale:10});await index.warm();assert.deepEqual(await index.emails([' a@example.com ','CONTACT@example.com','delivery@example.com','checkout@example.com']),['1']);
 rows=[{...row,customer_email:'b@example.com',contact_email:null,shipping_email:null,checkout_email:null}];now+=11;assert.deepEqual(await index.emails(['a@example.com','contact@example.com','delivery@example.com','checkout@example.com']),[]);assert.deepEqual(await index.emails(['b@example.com']),['1']);rows=[];await index.refreshAll();assert.deepEqual(await index.emails(['b@example.com']),[]);await index.close();
});
