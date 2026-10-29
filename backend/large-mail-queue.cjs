'use strict';
const {ImapFlow}=require('imapflow');
const {simpleParser}=require('mailparser');
const {imapOptions,messageFromParsed}=require('./imap.cjs');
const {saveReceived}=require('./files.cjs');
const START='2026-10-22T04:00:00.000Z',LIMIT=50*1024*1024;
function reference(value){try{const r=JSON.parse(value);if(r.length===4&&r[0]==='imap'&&typeof r[1]==='string'&&r[1]&&/^\d+$/.test(r[2])&&/^[1-9]\d*$/.test(r[3]))return{folder:r[1],validity:r[2],uid:r[3]};}catch{}throw Error('IMAP_LARGE_INVALID_REFERENCE');}
async function fetchLargeMessage(config,inbox,providerId,{createClient=o=>new ImapFlow(o),parse=simpleParser,signal,timeout,reserveBytes=async()=>{}}={}){
 const ref=reference(providerId),client=createClient(imapOptions(config,inbox.address));client.on('error',()=>{});let lock,timer,rejectStop;
 const stopped=new Promise((_,reject)=>{rejectStop=reject;});
 const stop=()=>{rejectStop(Error(signal?.aborted?'IMAP_LARGE_INTERRUPTED':'IMAP_LARGE_TIMEOUT'));client.close();};
 timer=setTimeout(stop,timeout??120000);timer.unref?.();signal?.addEventListener('abort',stop,{once:true});
 const operation=async()=>{
  if(signal?.aborted)throw Error('IMAP_LARGE_INTERRUPTED');
  await client.connect();lock=await client.getMailboxLock(ref.folder,{readOnly:true});
  if(String(client.mailbox.uidValidity)!==ref.validity)throw Error('IMAP_LARGE_UID_CHANGED');
  // Zoho can underreport RFC822.SIZE without ENVELOPE; the combined query matches raw MIME bytes.
  const row=await client.fetchOne(ref.uid,{uid:true,size:true,internalDate:true,envelope:true},{uid:true});
  if(!row)throw Error('IMAP_LARGE_MISSING');
  const received=new Date(row.internalDate).getTime();if(!row.internalDate||!Number.isFinite(received))throw Error('IMAP_LARGE_DATE_REVIEW');
  if(received<Date.parse(START))return null;
  if(!Number.isSafeInteger(row.size)||row.size<0||row.size>LIMIT)throw Error('IMAP_LARGE_SIZE_REVIEW');
  // Waiting for another download's memory must not consume this download's time budget.
  if(timeout===undefined)clearTimeout(timer);
  // Keep IMAP alive while a larger message waits for the shared memory budget.
  const keepAlive=setInterval(()=>{client.noop?.().catch(()=>{});},30000);keepAlive.unref?.();
  try{await reserveBytes(row.size);}finally{clearInterval(keepAlive);}
  if(signal?.aborted)throw Error('IMAP_LARGE_INTERRUPTED');
  // Slow mailbox servers may deliver only a few KB/s. Keep a finite size-based budget.
  if(timeout===undefined){clearTimeout(timer);timer=setTimeout(stop,Math.min(120*60000,120000+Math.ceil(row.size/8192)*1000));timer.unref?.();}
  // One bounded MIME buffer avoids retaining all chunks plus a second concatenated copy.
  const source=Buffer.alloc(row.size);let bytes=0;
  while(bytes<row.size){
   if(signal?.aborted)throw Error('IMAP_LARGE_INTERRUPTED');
   const length=Math.min(256*1024,row.size-bytes);
   let chunk;
   // A transient empty partial response is not EOF when RFC822.SIZE says bytes remain.
   for(let attempt=0;attempt<3;attempt++){
    const part=await client.fetchOne(ref.uid,{source:{start:bytes,maxLength:length}},{uid:true});chunk=part?.source;
    if(Buffer.isBuffer(chunk)&&chunk.length)break;
   }
   if(!Buffer.isBuffer(chunk)||!chunk.length){console.warn('LARGE_MAIL_INCOMPLETE',JSON.stringify({expected:row.size,offset:bytes,received:chunk?.length??null}));throw Error('IMAP_LARGE_INCOMPLETE');}
   if(chunk.length>length){
    // Some servers ignore partial ranges. Accept only a complete first response.
    if(bytes!==0||chunk.length!==row.size){console.warn('LARGE_MAIL_RANGE_MISMATCH',JSON.stringify({expected:row.size,offset:bytes,requested:length,received:chunk.length}));throw Error('IMAP_LARGE_INCOMPLETE');}
   }
   chunk.copy(source,bytes);bytes+=chunk.length;
  }
  if(bytes!==row.size)throw Error('IMAP_LARGE_INCOMPLETE');
  const tail=await client.fetchOne(ref.uid,{source:{start:bytes,maxLength:1}},{uid:true});
  if(!tail||!Buffer.isBuffer(tail.source)||tail.source.length){console.warn('LARGE_MAIL_TAIL_MISMATCH',JSON.stringify({expected:row.size,received:tail?.source?.length??null}));throw Error('IMAP_LARGE_INCOMPLETE');}
  const mail=await parse(source,{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
  if(signal?.aborted)throw Error('IMAP_LARGE_INTERRUPTED');
  return messageFromParsed(mail,row,inbox,ref.folder,ref.validity);
 };
 try{return await Promise.race([operation(),stopped]);}
 catch(e){throw Error(e.authenticationFailed?'IMAP_AUTH_FAILED':/^IMAP_LARGE_/.test(e.message)?e.message:'IMAP_LARGE_DOWNLOAD_FAILED');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);lock?.release();client.close();}
}
function createLargeMailQueue(store,accounts,{enabled=()=>true,onImport=()=>{},fetchMessage=fetchLargeMessage,clock=Date.now,interval=15000}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS large_mail_jobs(inbox_id TEXT NOT NULL,provider_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error_code TEXT,updated_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(inbox_id,provider_id));
 CREATE INDEX IF NOT EXISTS large_mail_pending ON large_mail_jobs(status,next_at);
 UPDATE large_mail_jobs SET status='retry',next_at=0 WHERE status='running';`);
 let closed=false,timer,started=false,usedBytes=0;const active=new Map(),waiting=[];
 function drain(){for(let n=0;n<waiting.length;){const w=waiting[n];if(usedBytes+w.bytes>LIMIT){n++;continue;}waiting.splice(n,1);usedBytes+=w.bytes;w.entry.bytes=w.bytes;w.entry.controller.signal.removeEventListener('abort',w.abort);w.resolve();}}
 function reserve(entry,bytes){return new Promise((resolve,reject)=>{
  const signal=entry.controller.signal;if(signal.aborted)return reject(Error('IMAP_LARGE_INTERRUPTED'));
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>LIMIT)return reject(Error('IMAP_LARGE_SIZE_REVIEW'));
  const w={entry,bytes,resolve,abort(){const i=waiting.indexOf(w);if(i>=0)waiting.splice(i,1);reject(Error('IMAP_LARGE_INTERRUPTED'));}};
  signal.addEventListener('abort',w.abort,{once:true});waiting.push(w);drain();
 });}
 const seed=()=>db.exec("INSERT OR IGNORE INTO large_mail_jobs(inbox_id,provider_id) SELECT inbox_id,provider_id FROM imap_skips WHERE reason='MESSAGE_LARGE_DEFERRED'");
 async function run(job,entry){
  const done=()=>{db.prepare("UPDATE large_mail_jobs SET status='done',error_code=NULL,updated_at=? WHERE inbox_id=? AND provider_id=?").run(clock(),job.inbox_id,job.provider_id);db.prepare("DELETE FROM imap_skips WHERE inbox_id=? AND provider_id=? AND reason='MESSAGE_LARGE_DEFERRED'").run(job.inbox_id,job.provider_id);};
  const imported=()=>db.prepare('SELECT 1 FROM messages m JOIN mime_imports i ON i.message_id=m.id WHERE m.inbox_id=? AND m.provider_id=?').get(job.inbox_id,job.provider_id);
  if(imported()){done();return true;}
  db.prepare("UPDATE large_mail_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE inbox_id=? AND provider_id=?").run(clock(),job.inbox_id,job.provider_id);
  try{
   const inbox=accounts.source('zoho',job.inbox_id),message=await fetchMessage(accounts.config('zoho',job.inbox_id),inbox,job.provider_id,{signal:entry.controller.signal,reserveBytes:bytes=>reserve(entry,bytes)});
   if(closed)throw Error('IMAP_LARGE_INTERRUPTED');
   if(message){if(message.inboxId!==job.inbox_id||message.providerId!==job.provider_id)throw Error('IMAP_LARGE_ID_MISMATCH');
    if(!imported()){const saved=store.upsertMessage(message);saveReceived(store,saved.id,message.attachments);onImport(saved,message);db.prepare('INSERT OR IGNORE INTO mime_imports VALUES(?)').run(saved.id);}
    done();
   }else db.prepare("UPDATE large_mail_jobs SET status='excluded',error_code='BEFORE_SYNC_START',updated_at=? WHERE inbox_id=? AND provider_id=?").run(clock(),job.inbox_id,job.provider_id);
  }catch(e){const code=/^(?:IMAP|ORDER)_[A-Z0-9_]+$/.test(e.message)?e.message:'IMAP_LARGE_IMPORT_FAILED';
   const review=/_(?:REVIEW|MISSING|UID_CHANGED|INVALID_REFERENCE|ID_MISMATCH)$/.test(code),interrupted=code==='IMAP_LARGE_INTERRUPTED';
   const attempts=job.attempts+(interrupted?0:1),status=review?'review':attempts>=3?'failed':'retry';
   db.prepare('UPDATE large_mail_jobs SET status=?,attempts=?,next_at=?,error_code=?,updated_at=? WHERE inbox_id=? AND provider_id=?').run(status,attempts,clock()+Math.min(900000,60000*2**attempts),code,clock(),job.inbox_id,job.provider_id);
  }return true;
 }
 function processNext(){
  if(!closed&&enabled()){
   seed();const jobs=db.prepare("SELECT * FROM large_mail_jobs WHERE status IN ('pending','retry') AND next_at<=? ORDER BY next_at,updated_at,inbox_id,provider_id").all(clock());
   for(const job of jobs){if(active.size>=2)break;let key;
    try{const c=accounts.config('zoho',job.inbox_id),i=accounts.source('zoho',job.inbox_id);key=JSON.stringify([String(c.host||'imappro.zoho.com').toLowerCase(),c.port||993,String(c.username||i.address).toLowerCase()]);}catch{key='invalid:'+job.inbox_id;}
    if(active.has(key))continue;
    const entry={controller:new AbortController(),bytes:0,promise:null};active.set(key,entry);
    entry.promise=run(job,entry).finally(()=>{usedBytes-=entry.bytes;active.delete(key);drain();});
   }
  }
  const promises=[...active.values()].map(e=>e.promise);
  return promises.length===1?promises[0]:promises.length?Promise.all(promises).then(()=>true):Promise.resolve(false);
 }
 function tick(){try{processNext().catch(()=>console.error('LARGE_MAIL_QUEUE_FAILED'));}catch{console.error('LARGE_MAIL_QUEUE_FAILED');}finally{if(!closed){timer=setTimeout(tick,interval);timer.unref?.();}}}
 return{processNext,start(){if(!closed&&!started){started=true;timer=setTimeout(tick,interval);timer.unref?.();}},stats:()=>db.prepare('SELECT status,count(*) count FROM large_mail_jobs GROUP BY status').all(),async close(){closed=true;clearTimeout(timer);const entries=[...active.values()];for(const e of entries)e.controller.abort();await Promise.allSettled(entries.map(e=>e.promise));}};
}
module.exports={createLargeMailQueue,fetchLargeMessage,reference};
