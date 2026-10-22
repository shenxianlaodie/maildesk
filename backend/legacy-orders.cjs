'use strict';
const {Worker}=require('node:worker_threads');const path=require('node:path');
function legacyOrders(source,cache){
 const worker=new Worker(path.join(__dirname,'legacy-orders-worker.cjs'),{workerData:{source,cache}}),pending=new Map();let seq=0,failed=false;
 worker.on('message',m=>{if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
 function fail(){failed=true;for(const p of pending.values())p.reject(Error('ORDER_DATABASE_UNAVAILABLE'));pending.clear();}
 worker.on('error',fail);worker.on('exit',fail);
 function call(method,...args){if(failed)return Promise.reject(Error('ORDER_DATABASE_UNAVAILABLE'));return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});}
 return{identifiers:tokens=>call('identifiers',tokens),refresh:(o,options)=>call('refresh',o,options),get:id=>call('get',id),byKeys:keys=>call('byKeys',keys),forEmails:(emails,ids=[])=>call('forEmails',emails,ids),search:(q,options)=>call('search',q,options),shops:()=>call('shops'),status:()=>call('status'),close:()=>worker.terminate()};
}
module.exports={legacyOrders};
