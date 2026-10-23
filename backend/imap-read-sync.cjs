'use strict';
const {ImapFlow}=require('imapflow');
const {imapOptions}=require('./imap.cjs');
function reference(value){try{const r=JSON.parse(value);if(Array.isArray(r)&&r.length===4&&r[0]==='imap'&&typeof r[1]==='string'&&r[1]&&/^\d+$/.test(r[2])&&/^[1-9]\d*$/.test(r[3]))return{folder:r[1],validity:String(r[2]),uid:String(r[3])};}catch{}return null;}
async function markRemoteRead(config,address,refs,{createClient=options=>new ImapFlow(options)}={}){
 const client=createClient(imapOptions(config,address));client.on('error',()=>{});
 const deadline=setTimeout(()=>client.close(),60000);deadline.unref?.();let lock;
 try{
  await client.connect();lock=await client.getMailboxLock(refs[0].folder,{readOnly:false});
  if(String(client.mailbox.uidValidity)!==refs[0].validity)throw Error('IMAP_READ_UIDVALIDITY_CHANGED');
  if(client.mailbox.readOnly)throw Error('IMAP_READ_MAILBOX_READONLY');
  const uids=refs.map(r=>r.uid).join(',');
  const found=await client.fetchAll(uids,{uid:true,flags:true},{uid:true});
  const read=refs[0].read!==false;
  const present=new Set(found.map(r=>String(r.uid))),pending=found.filter(r=>Boolean(r.flags?.has('\\Seen'))!==read).map(r=>r.uid);
  if(pending.length){const ok=await client[read?'messageFlagsAdd':'messageFlagsRemove'](pending.join(','),['\\Seen'],{uid:true});if(!ok)throw Error('IMAP_READ_STORE_FAILED');}
  const verified=await client.fetchAll(uids,{uid:true,flags:true},{uid:true});
  const seen=new Set(verified.filter(r=>r.flags?.has('\\Seen')).map(r=>String(r.uid)));
  return refs.map(r=>({uid:r.uid,status:!present.has(r.uid)?'missing':seen.has(r.uid)===read?'done':'retry'}));
 }catch(e){throw Error(e.authenticationFailed?'IMAP_AUTH_FAILED':/^IMAP_READ_/.test(e.message)?e.message:'IMAP_READ_SYNC_FAILED');}
 finally{clearTimeout(deadline);lock?.release();try{await client.logout();}catch{client.close();}}
}
function createReadSync(store,accounts,{send=markRemoteRead,clock=Date.now,interval=15000}={}){
 const db=store.db;db.exec("CREATE TABLE IF NOT EXISTS imap_read_jobs(message_id TEXT PRIMARY KEY REFERENCES messages(id),version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error_code TEXT,updated_at INTEGER NOT NULL)");
 if(!db.prepare('PRAGMA table_info(imap_read_jobs)').all().some(c=>c.name==='desired_read'))db.exec('ALTER TABLE imap_read_jobs ADD COLUMN desired_read INTEGER NOT NULL DEFAULT 1');
 let closed=false,started=false,timer=null,running=null;
 function enqueue(ids,read=true){let count=0;for(const id of ids){const m=db.prepare("SELECT provider_id FROM messages WHERE id=? AND direction='inbound'").get(id);if(!m||!reference(m.provider_id))continue;db.prepare("INSERT INTO imap_read_jobs(message_id,updated_at,desired_read) VALUES(?,?,?) ON CONFLICT(message_id) DO UPDATE SET version=version+1,status='pending',attempts=0,next_at=0,error_code=NULL,updated_at=excluded.updated_at,desired_read=excluded.desired_read").run(id,clock(),read?1:0);count++;}return count;}
 async function process(){
  const rows=db.prepare("SELECT j.*,m.inbox_id,m.provider_id FROM imap_read_jobs j JOIN messages m ON m.id=j.message_id WHERE j.status IN('pending','retry') AND j.next_at<=? ORDER BY j.updated_at LIMIT 50").all(clock());
  const groups=new Map();for(const row of rows){row.ref=reference(row.provider_id);if(!row.ref)continue;row.ref.read=!!row.desired_read;const key=JSON.stringify([row.inbox_id,row.ref.folder,row.ref.validity,row.desired_read]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const group of groups.values()){
   if(closed)break;let result,error;
   try{const inbox=accounts.source('zoho',group[0].inbox_id);result=await send(accounts.config('zoho',inbox.id),inbox.address,group.map(r=>r.ref));}catch(e){error=/^(IMAP_|MISSING_IMAP_PASSWORD|ACCOUNT_NOT_FOUND)/.test(e.message)?e.message:'IMAP_READ_SYNC_FAILED';}
   for(const row of group){const item=result?.find(r=>r.uid===row.ref.uid);const permanent=error==='IMAP_READ_UIDVALIDITY_CHANGED'||item?.status==='missing';const status=permanent?'failed':!error&&item?.status==='done'?'done':'retry';db.prepare('UPDATE imap_read_jobs SET status=?,attempts=attempts+1,next_at=?,error_code=?,updated_at=? WHERE message_id=? AND version=?').run(status,clock()+Math.min(600000,15000*2**Math.min(row.attempts,6)),status==='done'?null:error||(permanent?'IMAP_READ_MESSAGE_MISSING':'IMAP_READ_VERIFY_FAILED'),clock(),row.message_id,row.version);}
  }
 }
 function schedule(delay=interval){if(!started||closed||timer)return;timer=setTimeout(()=>{timer=null;run().catch(()=>{});},delay);timer.unref?.();}
 function run(){if(closed)return Promise.resolve();if(running)return running;running=process().finally(()=>{running=null;schedule();});return running;}
 return{enqueue,run,wake(){if(timer){clearTimeout(timer);timer=null;}schedule(0);},start(){started=true;schedule(0);},async close(){closed=true;clearTimeout(timer);if(running)await running;}};
}
module.exports={reference,markRemoteRead,createReadSync};
