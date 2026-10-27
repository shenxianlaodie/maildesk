'use strict';
function cacheCustomerOrders(service,{clock=Date.now,ttl=5000,limit=100}={}){
 const entries=new Map();let epoch=0;
 function invalidate(){epoch++;entries.clear();}
 async function forCustomer(id,{fresh=false}={}){
  const prior=entries.get(id);if(!fresh&&prior&&clock()-prior.started<ttl)return structuredClone(await prior.promise);
  const generation=epoch,entry={started:clock()};entry.promise=Promise.resolve().then(()=>service.forCustomer(id));entries.set(id,entry);
  while(entries.size>limit)entries.delete(entries.keys().next().value);
  try{const value=await entry.promise;if(generation!==epoch&&entries.get(id)===entry)entries.delete(id);return structuredClone(value);}catch(e){if(entries.get(id)===entry)entries.delete(id);throw e;}
 }
 const result={...service,forCustomer,invalidate};
 for(const name of ['link','refresh','saveNotes'])if(service[name])result[name]=async(...args)=>{try{return await service[name](...args);}finally{invalidate();}};
 return result;
}
module.exports={cacheCustomerOrders};
