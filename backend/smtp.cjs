'use strict';
const {outgoingFiles}=require('./files.cjs');
const nodemailer=require('nodemailer');
const {email}=require('./database.cjs');
function transport(config,address){const c=require('./connection-config.cjs').mailConfig(config,'smtp',address);if(!c.password||(!c.explicitUsername&&c.username!==address))throw Error('SMTP_CONFIG_REQUIRED');return nodemailer.createTransport({host:c.host,port:c.port,secure:c.security==='tls',requireTLS:c.security==='starttls',auth:{user:c.username,pass:c.password},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},logger:false,debug:false,connectionTimeout:20000,socketTimeout:45000,disableFileAccess:true,disableUrlAccess:true});}
async function sendReply(store,config,pilot,input,makeTransport=transport){
 if(!/^[a-f0-9-]{36}$/.test(input.requestId||''))throw Error('INVALID_REQUEST_ID');
 const prior=store.db.prepare('SELECT status FROM outgoing WHERE id=?').get(input.requestId);if(prior)return{status:prior.status};
 const parent=store.db.prepare("SELECT * FROM messages WHERE id=? AND direction='inbound' AND inbox_id=?").get(input.messageId,pilot.sourceInboxId||pilot.inboxId);if(!parent)throw Error('REPLY_MESSAGE_REQUIRED');
 const to=email(parent.from_address);const realMode=store.db.prepare("SELECT value FROM app_settings WHERE key='sending_mode'").get()?.value==='real';if(!realMode&&!(config.testRecipients||[]).includes(to))throw Error('TEST_RECIPIENT_REQUIRED');
 const attachments=outgoingFiles(input.attachments);if(typeof input.text!=='string'||(!input.text.trim()&&!attachments.length)||input.text.length>50000)throw Error('INVALID_REPLY_TEXT');
 const lastInbound=store.db.prepare("SELECT max(rowid) n FROM messages WHERE customer_id=? AND direction='inbound'").get(parent.customer_id).n;
 const client=makeTransport(config,pilot.address);const subject=/^re:/i.test(parent.subject)?parent.subject:'Re: '+parent.subject;const rfc=`<${input.requestId}@${pilot.address.split('@')[1]}>`;
 store.db.prepare('INSERT INTO outgoing(id,customer_id,parent_id,recipient,subject,body,status,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(input.requestId,parent.customer_id,parent.id,to,subject,input.text,'sending',pilot.actor,new Date().toISOString());
 store.db.prepare('INSERT INTO outgoing_routes VALUES(?,?,?,?,?)').run(input.requestId,pilot.inboxId,pilot.address,pilot.replyShopId||null,pilot.replyOrderId||null);
 for(const [i,a] of attachments.entries())store.db.prepare('INSERT INTO outgoing_files VALUES(?,?,?,?)').run(input.requestId,i,a.filename,a.content);
 try{const info=await client.sendMail({attachments,from:pilot.address,to,subject,text:input.text,messageId:rfc,...(parent.rfc_message_id?{inReplyTo:parent.rfc_message_id,references:[parent.rfc_message_id]}:{})});if(!info.accepted?.some(a=>String(a).toLowerCase()===to))throw Error('SMTP_REJECTED');
 store.transaction(()=>{store.db.prepare("UPDATE outgoing SET status='accepted' WHERE id=?").run(input.requestId);store.assignFirstReply(parent.customer_id,pilot.actor,input.requestId);store.db.prepare("UPDATE customer_work SET status='done',draft='',revision=revision+1,updated_at=? WHERE customer_id=? AND (SELECT max(rowid) FROM messages WHERE customer_id=? AND direction='inbound')=?").run(new Date().toISOString(),parent.customer_id,parent.customer_id,lastInbound);store.audit(pilot.actor,'mail.send',input.requestId,{recipient:to});});
 return{status:'accepted'};
 }catch(err){const definite=err.code==='EAUTH'||err.code==='EENVELOPE'||err.message==='SMTP_REJECTED'||(err.responseCode>=400&&err.responseCode<600);const status=definite?'failed':'unknown';store.db.prepare('UPDATE outgoing SET status=? WHERE id=?').run(status,input.requestId);return{status};}finally{client.close();}
}
module.exports={sendReply,transport};
