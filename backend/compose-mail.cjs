'use strict';
const {createHash}=require('node:crypto');
const {email}=require('./database.cjs');
const {outgoingFiles}=require('./files.cjs');
const {transport}=require('./smtp.cjs');
function installCompose(db){
 // A new message has no inbound parent. Preserve all existing rows, indexes and child references.
 if(db.prepare('PRAGMA table_info(outgoing)').all().find(c=>c.name==='parent_id')?.notnull){
  const objects=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='outgoing' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const definition=db.prepare("SELECT sql FROM sqlite_master WHERE name='outgoing'").get().sql;
  const next=definition.replace(/CREATE TABLE (?:IF NOT EXISTS )?["`]?outgoing["`]?/i,'CREATE TABLE outgoing_compose_migration').replace(/parent_id TEXT NOT NULL/i,'parent_id TEXT');
  if(next===definition||/parent_id TEXT NOT NULL/i.test(next))throw Error('COMPOSE_MIGRATION_REQUIRED');
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try{db.exec(next);db.exec('INSERT INTO outgoing_compose_migration SELECT * FROM outgoing; DROP TABLE outgoing; ALTER TABLE outgoing_compose_migration RENAME TO outgoing;');for(const obj of objects)db.exec(obj.sql);if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('COMPOSE_MIGRATION_FOREIGN_KEY');db.exec('COMMIT;');}catch(e){db.exec('ROLLBACK;');throw e;}finally{db.exec('PRAGMA foreign_keys=ON;');}
 }
 db.exec('CREATE TABLE IF NOT EXISTS compose_requests(request_id TEXT PRIMARY KEY REFERENCES outgoing(id),fingerprint TEXT NOT NULL);');
}
async function sendNewMail(store,config,pilot,input,makeTransport=transport){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId||''))throw Error('INVALID_REQUEST_ID');
 if(typeof input.to!=='string'||input.to.length>254||/[,;\r\n]/.test(input.to))throw Error('INVALID_EMAIL');
 const to=email(input.to);
 if(typeof input.subject!=='string'||!input.subject.trim()||input.subject.length>500||/[\x00-\x1f\x7f]/.test(input.subject))throw Error('INVALID_MAIL_SUBJECT');
 const subject=input.subject.trim(),attachments=outgoingFiles(input.attachments);
 if(typeof input.text!=='string'||(!input.text.trim()&&!attachments.length)||input.text.length>50000)throw Error('INVALID_REPLY_TEXT');
 store.actor(pilot.actor);
 const fingerprint=createHash('sha256').update(JSON.stringify([pilot.actor,pilot.inboxId,pilot.address,to,subject,input.text,attachments.map(a=>[a.filename,a.content.toString('base64')])])).digest('hex');
 const prior=store.db.prepare('SELECT o.*,c.fingerprint FROM outgoing o LEFT JOIN compose_requests c ON c.request_id=o.id WHERE o.id=?').get(input.requestId);
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('REQUEST_ID_REUSED');return{status:prior.status,customerId:prior.customer_id};}
 const real=store.db.prepare("SELECT value FROM app_settings WHERE key='sending_mode'").get()?.value==='real';
 if(!real&&!(config.testRecipients||[]).includes(to))throw Error('TEST_RECIPIENT_REQUIRED');
 const client=makeTransport(config,pilot.address);let customerId;
 try{store.transaction(()=>{customerId=store.customer(to);store.db.prepare('INSERT INTO outgoing VALUES(?,?,?,?,?,?,?,?,?)').run(input.requestId,customerId,null,to,subject,input.text,'sending',pilot.actor,new Date().toISOString());store.db.prepare('INSERT INTO outgoing_routes VALUES(?,?,?,?,?)').run(input.requestId,pilot.inboxId,pilot.address,null,null);store.db.prepare('INSERT INTO compose_requests VALUES(?,?)').run(input.requestId,fingerprint);for(const [i,a]of attachments.entries())store.db.prepare('INSERT INTO outgoing_files VALUES(?,?,?,?)').run(input.requestId,i,a.filename,a.content);});}catch(e){client.close();throw e;}
 try{
  const info=await client.sendMail({from:pilot.address,to,subject,text:input.text,attachments,messageId:`<${input.requestId}@${pilot.address.split('@')[1]}>`});
  if(!info.accepted?.some(a=>String(a).toLowerCase()===to))throw Error('SMTP_REJECTED');
  store.transaction(()=>{store.db.prepare("UPDATE outgoing SET status='accepted' WHERE id=?").run(input.requestId);store.assignFirstReply(customerId,pilot.actor,input.requestId);store.audit(pilot.actor,'mail.compose',input.requestId,{recipient:to,inboxId:pilot.inboxId});});
  return{status:'accepted',customerId};
 }catch(e){const definite=['EAUTH','EENVELOPE'].includes(e.code)||e.message==='SMTP_REJECTED'||(e.responseCode>=400&&e.responseCode<600);const status=definite?'failed':'unknown';store.db.prepare('UPDATE outgoing SET status=? WHERE id=?').run(status,input.requestId);return{status,customerId};}finally{client.close();}
}
module.exports={installCompose,sendNewMail};
