'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOrderLookup}=require('../backend/order-lookup.cjs');
const {createOrderDatabase}=require('../backend/order-database.cjs');
const row={id:'1',order_number:'OLD123',customer_email:'old@example.com'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('cold identifier lookup returns before the full index finishes',async()=>{
 let release,done=false;const gate=new Promise(r=>release=r),calls=[];
 const index=createOrderLookup(async()=>{await gate;return[row];},{directIdentifierLookup:async values=>{calls.push(values);return['2'];}});
 const result=index.identifiers([' NEW456 ','new456']).then(ids=>{done=true;return ids;});
 try{await tick();assert.equal(done,true);assert.deepEqual(await result,['2']);assert.deepEqual(calls,[['new456']]);}
 finally{release();await result;await index.close();}
});

test('expired identifier and email lookups query directly while refresh is pending',async()=>{
 let now=1000,release;const gate=new Promise(r=>release=r),direct=[];
 const index=createOrderLookup(async()=>{if(now>1000)await gate;return[row];},{clock:()=>now,ttl:10,maxStale:20,directIdentifierLookup:async()=>{direct.push('number');return['2'];},coldEmailLookup:async()=>{direct.push('email');return['3'];}});
 await index.warm();assert.deepEqual(await index.identifiers(['OLD123']),['1']);now+=21;
 let done=false;const result=Promise.all([index.identifiers(['NEW456']),index.emails(['new@example.com'])]).then(v=>{done=true;return v;});
 try{await tick();assert.equal(done,true);assert.deepEqual(await result,[['2'],['3']]);assert.deepEqual(direct,['number','email']);}
 finally{release();await result;await index.close();}
});

test('direct query errors remain errors and never become a false no-match',async()=>{
 const index=createOrderLookup(async()=>[row],{directIdentifierLookup:async()=>{throw Error('database offline');}});
 try{await assert.rejects(index.identifiers(['NEW456']),/database offline/);}finally{await index.close();}
});

test('empty identifiers do not start a database scan',async()=>{
 let reads=0;const index=createOrderLookup(async()=>{reads++;return[];},{directIdentifierLookup:async()=>{reads++;return[];}});
 assert.deepEqual(await index.identifiers(['','  ']),[]);assert.equal(reads,0);await index.close();
});

test('database wires normalized parameters into direct identifier SQL, including history',async()=>{
 const calls=[];class Pool{on(){}async connect(){return{query:async(text,values)=>{calls.push({text,values});return{rows:text.includes('tracking_number_history')?[{id:'42'}]:[]};},release(){}};}async end(){}}
 const db=createOrderDatabase('postgres://reader:example@localhost/orders?sslmode=require',{PoolImpl:Pool});
 try{assert.deepEqual(await db.lookup.identifiers([" ORDER123' "]),['42']);const direct=calls.find(c=>c.text.includes('tracking_number_history'));assert.ok(direct);assert.deepEqual(direct.values,[["order123'"]]);assert.ok(!direct.text.includes("order123'"));assert.match(direct.text,/tracking_items/);}
 finally{await db.close();}
});

test('known order numbers bypass expensive tracking JSON scans; only unmatched tokens fall back',async()=>{
 const calls=[];class Pool{on(){}async connect(){return{query:async(text,values)=>{calls.push({text,values});if(text.includes('ORDER BY support_order_snapshots.id'))return{rows:[]};if(text.includes('tracking_number_history'))return{rows:[{id:'9'}]};return{rows:[{id:'42',order_number:' ORDER123 ',order_id:'prefix-ORDER123'},{id:'43',order_number:'ORDER123',order_id:'other-order'}]};},release(){}};}async end(){}}
 const db=createOrderDatabase('postgres://reader:example@localhost/orders?sslmode=require',{PoolImpl:Pool});
 try{assert.deepEqual(await db.lookup.identifiers(['ORDER123']),['42','43']);assert.equal(calls.some(c=>c.text.includes('tracking_number_history')),false);}
 finally{await db.close();}
 calls.length=0;const mixed=createOrderDatabase('postgres://reader:example@localhost/orders?sslmode=require',{PoolImpl:Pool});
 try{assert.deepEqual(await mixed.lookup.identifiers(['ORDER123','TRACK999']),['42','43','9']);assert.deepEqual(calls.find(c=>c.text.includes('tracking_number_history')).values,[['track999']]);}
 finally{await mixed.close();}
});

test('warm index uses the same order-first matching rule and preserves duplicate shop candidates',async()=>{
 const index=createOrderLookup(async()=>[
  {...row,id:'1',order_number:'ORDER123'},
  {...row,id:'2',order_number:'ORDER123'},
  {...row,id:'3',order_number:'OTHER123',fulfillments:[{tracking_number:'ORDER123'},{tracking_number:'TRACK999'}]}
 ]);
 try{await index.warm();assert.deepEqual(await index.identifiers(['ORDER123']),['1','2']);assert.deepEqual(await index.identifiers(['ORDER123','TRACK999']),['1','2','3']);}
 finally{await index.close();}
});
