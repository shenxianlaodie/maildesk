'use strict';
const stages={connect:'连接',auth:'登录',sender:'发件人校验',recipient:'收件人校验',send:'发送',unknown:'未知阶段'};
function diagnose(error,config={},input={},recipient=''){
 const code=/^[A-Z][A-Z0-9_]{0,39}$/.test(error.code||'')?error.code:'SMTP_ERROR';
 const rawCommand=String(error.command||'').toUpperCase();
 const command=['CONN','EHLO','HELO','STARTTLS','AUTH','MAIL FROM','RCPT TO','DATA'].find(c=>rawCommand===c||rawCommand.startsWith(c+' '))||'';
 const stage=code==='EAUTH'||command==='AUTH'?'auth':command==='RCPT TO'?'recipient':command==='MAIL FROM'?'sender':command==='DATA'?'send':['CONN','EHLO','HELO','STARTTLS'].includes(command)||['ECONNECTION','EDNS','ESOCKET'].includes(code)?'connect':'unknown';
 const responseCode=Number.isInteger(error.responseCode)&&error.responseCode>=400&&error.responseCode<600?error.responseCode:null;
 let response=typeof error.response==='string'?error.response.slice(0,4096):'';
 const enhancedCode=response.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/)?.[0]||null;
 const reason=/quota|limit exceeded|too many|rate limit/i.test(response)?'邮件服务器限制发信，请检查额度或频率限制。':stage==='auth'?'邮箱登录被拒绝，请检查授权或账号状态。':code==='ETIMEDOUT'?'邮件服务器响应超时。':stage==='recipient'?'邮件服务器拒绝收件人。':responseCode?'邮件服务器明确拒绝本次发送。':'连接中断或发送未完成，无法确认投递结果。';
 // Never retain arbitrary Error.message, stack, body or AUTH payloads.
 const secrets=[config.password,config.username,input.text,input.subject,input.originalBody,recipient];
 if(config.password)secrets.push(Buffer.from(config.password).toString('base64'));
 if(config.username&&config.password)secrets.push(Buffer.from('\0'+config.username+'\0'+config.password).toString('base64'));
 for(const secret of secrets.filter(v=>typeof v==='string'&&v.length).sort((a,b)=>b.length-a.length))response=response.split(secret).join('[已隐藏]');
 response=response.replace(/https?:\/\/\S+/gi,'[链接已隐藏]').replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi,'[邮箱已隐藏]').replace(/\b(?:password|token|secret|authorization)\s*[:=]\s*\S+/gi,'[授权信息已隐藏]').replace(/[A-Za-z0-9+/=_-]{32,}/g,'[标识已隐藏]').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,600);
 if(stage==='auth')response=''; // Authentication errors can echo credentials in provider-specific encodings.
 return{code,responseCode,enhancedCode,command,stage,stageLabel:stages[stage],reason,response};
}
function record(db,id,error,config,input,recipient){const failure=diagnose(error,config,input,recipient);const route=db.prepare('SELECT from_address FROM outgoing_routes WHERE outgoing_id=?').get(id);failure.fromAddress=route?.from_address||'';db.prepare('INSERT OR REPLACE INTO outgoing_failures(outgoing_id,at,details) VALUES(?,?,?)').run(id,new Date().toISOString(),JSON.stringify(failure));return failure;}
function read(db,id){const row=db.prepare('SELECT details FROM outgoing_failures WHERE outgoing_id=?').get(id);return row?JSON.parse(row.details):null;}
function logDetails(failure){const result={};for(const [key,field] of Object.entries({smtpFrom:'fromAddress',smtpStage:'stageLabel',smtpCode:'code',smtpResponseCode:'responseCode',smtpEnhancedCode:'enhancedCode',smtpReason:'reason',smtpResponse:'response'})){const value=failure[field];if(typeof value==='string')result[key]=value.slice(0,600);else if(Number.isInteger(value))result[key]=value;}return result;}
module.exports={diagnose,record,read,logDetails};
