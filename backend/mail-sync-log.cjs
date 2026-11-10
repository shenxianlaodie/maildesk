'use strict';
function mailError(e,stage){
 let code;
 if(e.authenticationFailed)code='IMAP_AUTH_FAILED';
 else if(/^(IMAP_[A-Z0-9_]+)$/.test(e.message||''))code=e.message;
 else if(['AMBIGUOUS_SENDER','MULTIPLE_RECIPIENTS_REVIEW','INVALID_MESSAGE_DATE','INVALID_EMAIL'].includes(e.message))code='IMAP_'+e.message;
 else if(['ETIMEDOUT','ETIMEOUT'].includes(e.code))code='IMAP_'+stage.toUpperCase()+'_TIMEOUT';
 else if(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','EPIPE'].includes(e.code))code='IMAP_'+e.code;
 else if(/CERT|TLS|SSL/.test(e.code||''))code='IMAP_TLS_FAILED';
 else code='IMAP_'+stage.toUpperCase()+'_FAILED';
 return{code,stage};
}
function startDownload(record,meta,{now=()=>performance.now()}={}){
 const startedAt=new Date().toISOString(),start=now();let finished=false;
 return(status,bytes=0,code=null)=>{if(finished)return;finished=true;const sample={...meta,startedAt,finishedAt:new Date().toISOString(),durationMs:Math.max(0,Math.round(now()-start)),status,bytes,code};try{record(sample);}catch{console.warn('MAIL_TIMING_WRITE_FAILED');}};
}
function mailLog(db){
 db.exec(`CREATE TABLE IF NOT EXISTS mail_sync_events(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,inbox_id TEXT,provider_id TEXT,run_id TEXT,stage TEXT NOT NULL,code TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS mail_sync_event_time ON mail_sync_events(created_at);
 CREATE INDEX IF NOT EXISTS mail_sync_event_run ON mail_sync_events(run_id);
 CREATE TABLE IF NOT EXISTS mail_download_samples(id INTEGER PRIMARY KEY,inbox_id TEXT,provider_id TEXT,mode TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT NOT NULL,duration_ms INTEGER NOT NULL,bytes INTEGER NOT NULL,code TEXT);
 CREATE INDEX IF NOT EXISTS mail_download_time ON mail_download_samples(finished_at);
 CREATE INDEX IF NOT EXISTS mail_download_inbox_time ON mail_download_samples(inbox_id,finished_at);
 CREATE TABLE IF NOT EXISTS mail_raw_archive(inbox_id TEXT NOT NULL,provider_id TEXT NOT NULL,source BLOB NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(inbox_id,provider_id));`);
 return{download({inboxId,providerId,mode,status,startedAt,finishedAt,durationMs,bytes=0,code=null}){try{db.prepare('INSERT INTO mail_download_samples(inbox_id,provider_id,mode,status,started_at,finished_at,duration_ms,bytes,code) VALUES(?,?,?,?,?,?,?,?,?)').run(inboxId,providerId,mode,status,startedAt,finishedAt,durationMs,bytes,code);}catch{console.warn('MAIL_TIMING_WRITE_FAILED');}},event({inboxId=null,providerId=null,runId=null,stage,code,attempt=0}){try{db.prepare('INSERT INTO mail_sync_events(created_at,inbox_id,provider_id,run_id,stage,code,attempt) VALUES(?,?,?,?,?,?,?)').run(new Date().toISOString(),inboxId,providerId,runId,stage,code,attempt);}catch{console.warn('MAIL_DIAGNOSTIC_WRITE_FAILED');}},raw(inboxId,providerId,source){db.prepare('INSERT INTO mail_raw_archive VALUES(?,?,?,?) ON CONFLICT(inbox_id,provider_id) DO UPDATE SET source=excluded.source').run(inboxId,providerId,source,new Date().toISOString());},hasRaw:(i,p)=>!!db.prepare('SELECT 1 FROM mail_raw_archive WHERE inbox_id=? AND provider_id=?').get(i,p)};
}
module.exports={mailError,mailLog,startDownload};
