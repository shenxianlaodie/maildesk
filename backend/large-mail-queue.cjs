'use strict';
const {ImapFlow}=require('imapflow');
const {simpleParser}=require('mailparser');
const {imapOptions,messageFromParsed}=require('./imap.cjs');
const {saveReceived}=require('./files.cjs');
const START='2026-10-22T04:00:00.000Z',LIMIT=20*1024*1024;
function reference(value){try{const r=JSON.parse(value);if(r.length===4&&r[0]==='imap'&&typeof r[1]==='string'&&r[1]&&/^\d+$/.test(r[2])&&/^[1-9]\d*$/.test(r[3]))return{folder:r[1],validity:r[2],uid:r[3]};}catch{}throw Error('IMAP_LARGE_INVALID_REFERENCE');}
async function fetchLargeMessage(config,inbox,providerId,{createClient=o=>new ImapFlow(o),parse=simpleParser,signal,timeout=240000}={}){
 const ref=reference(providerId),client=createClient(imapOptions(config,inbox.address));client.on('error',()=>{});let lock,timer,rejectStop;
 const stopped=new Promise((_,reject)=>{rejectStop=reject;});
 const stop=()=>{rejectStop(Error(signal?.aborted?'IMAP_LARGE_INTERRUPTED':'IMAP_LARGE_TIMEOUT'));client.close();};
 timer=setTimeout(stop,timeout);timer.unref?.();signal?.addEventListener('abort',stop,{once:true});
 const operation=async()=>{
  if(signal?.aborted)throw Error('IMAP_LARGE_INTERRUPTED');
  await client.connect();lock=await client.getMailboxLock(ref.folder,{readOnly:true});
  if(String(client.mailbox.uidValidity)!==ref.validity)throw Error('IMAP_LARGE_UID_CHANGED');
  const row=await client.fetchOne(ref.uid,{uid:true,size:true,internalDate:true},{uid:true});
  if(!row)throw Error('IMAP_LARGE_MISSING');
  const received=new Date(row.internalDate).getTime();if(!row.internalDate||!Number.isFinite(received))throw Error('IMAP_LARGE_DATE_REVIEW');
  if(received<Date.parse(START))return null;
  if(!Number.isFinite(row.size)||row.size>LIMIT)throw Error('IMAP_LARGE_SIZE_REVIEW');
  const {content}=await client.download(ref.uid,undefined,{uid:true,chunkSize:256*1024,maxBytes:LIMIT+1});
  if(!content)throw Error('IMAP_LARGE_MISSING');
  const chunks=[];let bytes=0;
  for await(const chunk of content){bytes+=chunk.length;if(bytes>LIMIT){content.destroy();throw Error('IMAP_LARGE_SIZE_REVIEW');}chunks.push(chunk);}
  if(bytes!==row.size)throw Error('IMAP_LARGE_INCOMPLETE');
  const mail=await parse(Buffer.concat(chunks),{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
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
 let closed=false,timer,busy=null,controller;
 const seed=()=>db.exec("INSERT OR IGNORE INTO large_mail_jobs(inbox_id,provider_id) SELECT inbox_id,provider_id FROM imap_skips WHERE reason='MESSAGE_LARGE_DEFERRED'");
 async function run(){
  if(closed||!enabled())return false;seed();
  const job=db.prepare("SELECT * FROM large_mail_jobs WHERE status IN ('pending','retry') AND next_at<=? ORDER BY next_at,updated_at,inbox_id,provider_id LIMIT 1").get(clock());if(!job)return false;
  const done=()=>{db.prepare("UPDATE large_mail_jobs SET status='done',error_code=NULL,updated_at=? WHERE inbox_id=? AND provider_id=?").run(clock(),job.inbox_id,job.provider_id);db.prepare("DELETE FROM imap_skips WHERE inbox_id=? AND provider_id=? AND reason='MESSAGE_LARGE_DEFERRED'").run(job.inbox_id,job.provider_id);};
  const imported=()=>db.prepare('SELECT 1 FROM messages m JOIN mime_imports i ON i.message_id=m.id WHERE m.inbox_id=? AND m.provider_id=?').get(job.inbox_id,job.provider_id);
  if(imported()){done();return true;}
  db.prepare("UPDATE large_mail_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE inbox_id=? AND provider_id=?").run(clock(),job.inbox_id,job.provider_id);controller=new AbortController();
  try{
   const inbox=accounts.source('zoho',job.inbox_id),message=await fetchMessage(accounts.config('zoho',job.inbox_id),inbox,job.provider_id,{signal:controller.signal});
   if(closed)throw Error('IMAP_LARGE_INTERRUPTED');
   if(message){if(message.inboxId!==job.inbox_id||message.providerId!==job.provider_id)throw Error('IMAP_LARGE_ID_MISMATCH');
    if(!imported()){const saved=store.upsertMessage(message);saveReceived(store,saved.id,message.attachments);onImport(saved,message);db.prepare('INSERT OR IGNORE INTO mime_imports VALUES(?)').run(saved.id);}
    done();
   }else db.prepare("UPDATE large_mail_jobs SET status='excluded',error_code='BEFORE_SYNC_START',updated_at=? WHERE inbox_id=? AND provider_id=?").run(clock(),job.inbox_id,job.provider_id);
  }catch(e){const code=/^(?:IMAP|ORDER)_[A-Z0-9_]+$/.test(e.message)?e.message:'IMAP_LARGE_IMPORT_FAILED';
   const review=/_(?:REVIEW|MISSING|UID_CHANGED|INVALID_REFERENCE|ID_MISMATCH)$/.test(code),interrupted=code==='IMAP_LARGE_INTERRUPTED';
   const attempts=job.attempts+(interrupted?0:1),status=review?'review':attempts>=3?'failed':'retry';
   db.prepare('UPDATE large_mail_jobs SET status=?,attempts=?,next_at=?,error_code=?,updated_at=? WHERE inbox_id=? AND provider_id=?').run(status,attempts,clock()+Math.min(900000,60000*2**attempts),code,clock(),job.inbox_id,job.provider_id);
  }finally{controller=null;}return true;
 }
 function processNext(){if(busy)return busy;busy=run().finally(()=>{busy=null;});return busy;}
 async function tick(){try{await processNext();}catch{console.error('LARGE_MAIL_QUEUE_FAILED');}finally{if(!closed){timer=setTimeout(tick,interval);timer.unref?.();}}}
 return{processNext,start(){if(!closed&&!timer){timer=setTimeout(tick,interval);timer.unref?.();}},stats:()=>db.prepare('SELECT status,count(*) count FROM large_mail_jobs GROUP BY status').all(),async close(){closed=true;clearTimeout(timer);controller?.abort();await busy;}};
}
module.exports={createLargeMailQueue,fetchLargeMessage,reference};
