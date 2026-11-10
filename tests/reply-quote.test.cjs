'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {sendReply}=require('../backend/smtp.cjs');
const nodemailer=require('nodemailer');
const {simpleParser}=require('mailparser');
for(const body of ['Where is my order?\r\n\r\nMerci!\r\n> Older reply','']){
 test('sent MIME quotes the selected customer email; local reply stays clean '+(body?'text':'empty'),async()=>{
  const store=new Store(':memory:');let raw;
  try{
   store.addInbox({id:'i',address:'support@example.com'});store.addStaff({id:'a',name:'Agent'});
   const parent=store.upsertMessage({inboxId:'i',providerId:'1',direction:'inbound',customerEmail:'customer@example.com',fromAddress:'customer@example.com',sentAt:'2026-10-22T09:21:00Z',subject:'Order TEST123',bodyText:body,rfcMessageId:'<original@example.com>'});
   // A newer, different message must not replace the explicitly selected parent.
   store.upsertMessage({inboxId:'i',providerId:'2',direction:'inbound',customerEmail:'customer@example.com',fromAddress:'customer@example.com',sentAt:'2026-10-22T09:22:00Z',subject:'Other order',bodyText:'Do not quote this'});
   const requestId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
   const result=await sendReply(store,{testRecipients:['customer@example.com']},{inboxId:'i',address:'support@example.com',actor:'a'},{requestId,messageId:parent.id,text:'We are checking your order.'},()=>({async sendMail(mail){const transport=nodemailer.createTransport({streamTransport:true,buffer:true});raw=(await transport.sendMail(mail)).message;return{accepted:['customer@example.com']};},close(){}}));
   assert.equal(result.status,'accepted');const parsed=await simpleParser(raw);
   assert.equal(parsed.inReplyTo,'<original@example.com>');assert.equal(parsed.subject,'Re: Order TEST123');
   assert.match(parsed.text,/We are checking your order\.\n\nOn Thu, 22 Oct 2026 09:21:00 GMT, customer@example.com wrote:/);
   assert.match(parsed.text,/> Subject: Order TEST123/);assert.doesNotMatch(parsed.text,/Do not quote this/);
   if(body)assert.match(parsed.text,/> Where is my order\?\n> \n> Merci!\n> > Older reply/);
   else assert.match(parsed.text,/No text content in the original email/);
   assert.equal(store.db.prepare('SELECT body FROM outgoing WHERE id=?').get(requestId).body,'We are checking your order.');
  }finally{store.close();}
 });
}
