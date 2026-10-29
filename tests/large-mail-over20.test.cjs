const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {fetchLargeMessage}=require('../backend/large-mail-queue.cjs');
test('a 32 MiB MIME mail imports its complete 24 MiB attachment',async()=>{
 const attachment=Buffer.alloc(24*1024*1024,0x71);
 const raw=Buffer.from('From: buyer@example.com\r\nTo: support@example.com\r\nSubject: Large attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=large-test\r\n\r\n--large-test\r\nContent-Type: text/plain\r\n\r\nPlease see attachment.\r\n--large-test\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=test.bin\r\nContent-Transfer-Encoding: base64\r\n\r\n'+attachment.toString('base64')+'\r\n--large-test--\r\n');
 let closed=false;
 const client={on(){},connect:async()=>{},getMailboxLock:async()=>({release(){}}),mailbox:{uidValidity:'1'},close(){closed=true;},fetchOne:async(uid,q)=>q.source?{source:raw.subarray(q.source.start,q.source.start+q.source.maxLength)}:{uid:1,size:raw.length,internalDate:new Date('2026-10-26T00:00:00Z')}};
 const message=await fetchLargeMessage({host:'imap.example.com',username:'support@example.com',password:'fake'},{id:'i',address:'support@example.com'},'["imap","INBOX","1","1"]',{createClient:()=>client});
 assert.equal(message.subject,'Large attachment');assert.match(message.bodyText,/Please see attachment/);
 assert.equal(message.attachments.length,1);assert.equal(message.attachments[0].content.length,attachment.length);
 const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(message.attachments[0].content),hash(attachment));assert.ok(closed);
});
