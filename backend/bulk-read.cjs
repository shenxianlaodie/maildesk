'use strict';
function bulkRead(store,input,scope,readSync){
 const ids=input.customerIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))||Object.hasOwn(input,'messageIds')||(input.read!==undefined&&input.read!==true))throw Error('INVALID_MESSAGES');
 const customerIds=[...new Set(ids)];
 // Validate the entire batch before any writes; shared customers may span mailboxes.
 for(const id of customerIds)scope?.customer(id);
 let messageIds=[],remoteQueued=0;
 store.transaction(()=>{
  messageIds=store.db.prepare(`SELECT m.id FROM messages m WHERE m.customer_id IN(SELECT value FROM json_each(?)) AND m.direction='inbound' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message_id=m.id) ${scope?'AND m.inbox_id IN(SELECT value FROM json_each(?))':''}`).all(...[JSON.stringify(customerIds),...(scope?[JSON.stringify(scope.ids)]:[])]).map(m=>m.id);
  const insert=store.db.prepare('INSERT OR IGNORE INTO message_reads(message_id,read_at) VALUES(?,?)'),at=new Date().toISOString();
  for(const id of messageIds)insert.run(id,at);
  if(messageIds.length)remoteQueued=readSync?.enqueue(messageIds,true)||0;
 });
 if(remoteQueued)readSync?.wake();
 return{saved:true,customers:customerIds.length,messages:messageIds.length,remoteQueued};
}
module.exports={bulkRead};
