'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {connectionOptions,createOrderDatabase}=require('../backend/order-database.cjs');
const url='postgresql://reader:example@localhost/orders?sslmode=require';
test('order connections require TLS and enforce read-only session defaults',()=>{
 const config=connectionOptions(url+'&options=unsafe');const parsed=new URL(config.connectionString);
 assert.equal(parsed.searchParams.get('sslmode'),'require');assert.equal(parsed.searchParams.get('uselibpqcompat'),'true');assert.equal(parsed.searchParams.has('options'),false);
 assert.match(config.options,/default_transaction_read_only=on/);assert.match(config.options,/statement_timeout/);
 assert.throws(()=>connectionOptions(url.replace('require','disable')),/SSL_REQUIRED/);
 assert.throws(()=>connectionOptions('invalid'),/URL_INVALID/);
 assert.equal(new URL(connectionOptions('postgres://reader@example.com/orders').connectionString).searchParams.get('sslmode'),'verify-full');
});
function fake(fail=false){const calls=[];let released;
 class Pool{on(){}async connect(){return{query:async(text,values)=>{calls.push({text,values});if(fail&&text==='SELECT test')throw Error('query failed');return{rows:[{ok:true}]};},release:value=>{released=value;}};}async end(){calls.push({text:'CLOSE'});}}
 return{Pool,calls,released:()=>released};
}
test('reads use one query round trip with parameterized values',async()=>{const f=fake(),db=createOrderDatabase(url,{PoolImpl:f.Pool});
 assert.deepEqual(await db.read('SELECT $1',['order-number']),[{ok:true}]);assert.deepEqual(f.calls.map(c=>c.text),['SELECT $1']);assert.deepEqual(f.calls[0].values,['order-number']);assert.equal(f.released(),false);await db.close();
});
test('failed reads discard the connection',async()=>{const f=fake(true),db=createOrderDatabase(url,{PoolImpl:f.Pool});await assert.rejects(db.read('SELECT test'),/query failed/);assert.deepEqual(f.calls.map(c=>c.text),['SELECT test']);assert.equal(f.released(),true);await db.close();});
test('inspection reads only connection state and order-related metadata',async()=>{const f=fake(),db=createOrderDatabase(url,{PoolImpl:f.Pool});await db.inspect();const selects=f.calls.filter(c=>c.text.startsWith('SELECT'));assert.equal(selects.length,2);assert.match(selects[1].text,/FROM information_schema.columns/);await db.close();});
test('business data directory override never changes demo storage',()=>{const {dataDirectory}=require('../scripts/environment.cjs');const path=require('node:path');const old=process.env.MAILDESK_DATA_DIR;try{process.env.MAILDESK_DATA_DIR=path.resolve('persistent-business-data');assert.equal(dataDirectory(false),process.env.MAILDESK_DATA_DIR);assert.notEqual(dataDirectory(true),process.env.MAILDESK_DATA_DIR);assert.equal(path.basename(dataDirectory(true)),'.demo-data');}finally{if(old===undefined)delete process.env.MAILDESK_DATA_DIR;else process.env.MAILDESK_DATA_DIR=old;}});

test('read helper rejects non-SELECT and multi-statement queries before connecting',async()=>{const f=fake(),db=createOrderDatabase(url,{PoolImpl:f.Pool});await assert.rejects(db.read('DELETE FROM orders'),/ORDER_SELECT_REQUIRED/);await assert.rejects(db.read('SELECT 1; SELECT 2'),/ORDER_SELECT_REQUIRED/);assert.equal(f.calls.length,0);await db.close();});
