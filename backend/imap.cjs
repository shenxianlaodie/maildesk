'use strict';
const {ImapFlow}=require('imapflow');
const {simpleParser}=require('mailparser');
const {textOnly}=require('./providers.cjs');
const {mailConfig}=require('./connection-config.cjs');
function validate(config,address){const c=mailConfig(config,'imap',address);if(c.username!==address&&!c.explicitUsername)throw Error('IMAP_ACCOUNT_MISMATCH');if(!c.password)throw Error('MISSING_IMAP_PASSWORD');return c;}
function imapOptions(config,address){const c=validate(config,address);return{host:c.host,port:c.port,secure:c.security==='tls',...(c.security==='starttls'?{doSTARTTLS:true}:{}),auth:{user:c.username,pass:c.password},logger:false,logRaw:false,disableAutoIdle:true,connectionTimeout:20000,greetingTimeout:20000,socketTimeout:60000,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'}};}
async function verifyImap(config,address,createClient=opts=>new ImapFlow(opts)){const client=createClient(imapOptions(config,address));client.on('error',()=>{});try{await client.connect();return{verified:true};}catch(err){throw Error(err.authenticationFailed?'IMAP_AUTH_FAILED':'IMAP_VERIFY_FAILED');}finally{try{await client.logout();}catch{client.close();}}}
function messageFromParsed(mail,row,inbox,folder,validity){const list=v=>(v?.value||[]).map(a=>a.address?.toLowerCase()).filter(Boolean);const from=list(mail.from),to=list(mail.to);if(from.length!==1)throw Error('AMBIGUOUS_SENDER');const outbound=from[0]===inbox.address;const recipients=[...new Set([...to,...list(mail.cc),...list(mail.bcc)].filter(a=>a!==inbox.address))];if(outbound&&recipients.length!==1)throw Error('MULTIPLE_RECIPIENTS_REVIEW');const sent=mail.date||row.internalDate;if(!sent||!Number.isFinite(new Date(sent).getTime()))throw Error('INVALID_MESSAGE_DATE');return{inboxId:inbox.id,providerId:JSON.stringify(['imap',folder,String(validity),String(row.uid)]),attachments:(mail.attachments||[]).map(a=>({filename:a.filename,contentType:a.contentType,content:a.content})),folderId:folder,direction:outbound?'outbound':'inbound',customerEmail:outbound?recipients[0]:from[0],customerName:outbound?'':mail.from.value[0].name||'',fromAddress:from[0],toAddresses:to,sentAt:new Date(sent).toISOString(),rfcMessageId:mail.messageId||null,inReplyTo:mail.inReplyTo||null,subject:mail.subject||'',bodyText:mail.text||textOnly(mail.html||'')};}

async function syncImap(config,inbox,onMessage,{createClient=opts=>new ImapFlow(opts),parse=simpleParser,history=false,automatic=false,hasMessage=()=>false,onProgress=()=>{},onSkip=()=>{},batchLimit=200,syncSince='2026-10-22T04:00:00.000Z'}={}){
 const cutoff=new Date(syncSince);if(!Number.isFinite(cutoff.getTime()))throw Error('IMAP_INVALID_CUTOFF');
 const client=createClient(imapOptions(config,inbox.address));client.on('error',()=>{});let processed=0,skipped=0,attempted=0,remaining=0;
 const deadline=setTimeout(()=>client.close(),automatic?60000:240000);deadline.unref?.();
 try{
  await client.connect();const folders=await client.list();const inboxFolder=folders.find(f=>f.path.toUpperCase()==='INBOX'||f.specialUse==='\\Inbox');
  const targets=[inboxFolder||{path:'INBOX'},...folders.filter(f=>f.specialUse==='\\Sent'&&f!==inboxFolder)];
  for(const folder of targets){let lock;try{lock=await client.getMailboxLock(folder.path,{readOnly:true});}catch(err){if(folder===targets[0]&&err.responseStatus==='NO')throw Error('IMAP_INBOX_UNAVAILABLE');throw err;}
   try{
    if(!client.mailbox.exists)continue;const validity=String(client.mailbox.uidValidity);
    const providerId=uid=>JSON.stringify(['imap',folder.path,validity,String(uid)]);
    // IMAP SINCE has day precision; internalDate below enforces the exact noon cutoff.
    const uids=await client.search({since:cutoff},{uid:true});
    const pending=(uids||[]).filter(uid=>!hasMessage(providerId(uid))).sort((a,b)=>b-a);
    const available=Math.max(0,batchLimit-attempted);remaining+=Math.max(0,pending.length-available);
    const selected=pending.slice(0,available);if(!selected.length)continue;
    const rows=await client.fetchAll(selected.join(','),{uid:true,size:true,internalDate:true},{uid:true});rows.sort((a,b)=>b.uid-a.uid);
    for(const row of rows){attempted++;onProgress({processed,skipped,folder:folder.path,attempted,remaining});const id=providerId(row.uid);
     if(!row.internalDate||!Number.isFinite(new Date(row.internalDate).getTime())){skipped++;onSkip(id,'MESSAGE_DATE_REVIEW');continue;}
     if(new Date(row.internalDate)<cutoff){onSkip(id,'BEFORE_SYNC_START');continue;}
     if(automatic&&row.size>5*1024*1024){skipped++;onSkip(id,'MESSAGE_LARGE_DEFERRED');continue;}
     if(row.size>20*1024*1024){skipped++;onSkip(id,'MESSAGE_REQUIRES_REVIEW');continue;}
     const full=await client.fetchOne(row.uid,{source:true},{uid:true});if(!full?.source){skipped++;continue;}
     let message;try{const mail=await parse(full.source,{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});message=messageFromParsed(mail,row,inbox,folder.path,validity);}catch{skipped++;onSkip(id,'MESSAGE_PARSE_REVIEW');continue;}
     await onMessage(message);processed++;onProgress({processed,skipped,folder:folder.path,attempted,remaining});
    }
   }finally{lock.release();}
  }
  return{processed,skipped,remaining};
 }catch(err){throw new Error(err.authenticationFailed?'IMAP_AUTH_FAILED':err.message==='IMAP_INBOX_UNAVAILABLE'?err.message:'IMAP_CONNECTION_OR_SYNC_FAILED');}
 finally{clearTimeout(deadline);try{await client.logout();}catch{client.close();}}
}

module.exports={syncImap,messageFromParsed,validate,verifyImap,imapOptions};
