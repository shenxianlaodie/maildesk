const test=require('node:test'),assert=require('node:assert/strict');
const {simpleParser}=require('mailparser');
const {messageFromParsed}=require('../backend/imap.cjs');
const {saveReceived}=require('../backend/files.cjs');
const {Store}=require('../backend/database.cjs');
test('MIME import preserves decoded subject and attachment bytes on repeat sync',async()=>{
 const bytes=Buffer.from([0,1,2,128,255]);
 const source=['From: Alice <alice@example.com>','To: support@example.com','Subject: =?UTF-8?B?5rWL6K+V?=','Date: Wed, 21 Oct 2026 10:00:00 +0000','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="test"','','--test','Content-Type: text/plain; charset=utf-8','','Hello','--test','Content-Type: application/octet-stream','Content-Disposition: attachment; filename="proof.bin"','Content-Transfer-Encoding: base64','',bytes.toString('base64'),'--test--',''].join('\r\n');
 const parsed=await simpleParser(source,{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
 const inbox={id:'i',address:'support@example.com'},store=new Store(':memory:');
 try{store.addInbox(inbox);let id;for(let i=0;i<2;i++){const message=messageFromParsed(parsed,{uid:1},inbox,'INBOX',1);id=store.upsertMessage(message).id;saveReceived(store,id,message.attachments);}
 assert.equal(store.db.prepare('SELECT subject FROM messages WHERE id=?').get(id).subject,'\u6d4b\u8bd5');
 assert.equal(store.db.prepare('SELECT count(*) n FROM attachments').get().n,1);
 const file=store.db.prepare('SELECT a.filename,f.content FROM attachments a JOIN file_contents f ON f.id=a.storage_key WHERE message_id=?').get(id);
 assert.equal(file.filename,'proof.bin');assert.deepEqual(Buffer.from(file.content),bytes);
 }finally{store.close();}
});
