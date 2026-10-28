'use strict';
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
// Only user-triggered writes belong in the administrator operation history.
const actions={
 '/api/read':'标记为未读',
 '/api/customer-labels':'修改顾客标签','/api/desk/profile':'修改顾客资料','/api/desk/order':'修改订单备注',
 '/api/desk/send-demo':'保存演示回复','/api/send':'发送邮件','/api/compose':'新建邮件','/api/order-links':'关联订单',
 '/api/classify':'邮件分类','/api/templates':'管理话术','/api/labels':'管理标签',
 '/api/settings/mailbox-permissions':'设置邮箱权限','/api/settings/signatures':'修改客服签名','/api/settings/ai':'修改 AI 配置','/api/settings/mailbox':'修改邮箱配置',
 '/api/settings/sending':'修改发信策略','/api/accounts':'修改店铺配置','/api/sync':'发起邮件同步'
};
function operation(method,pathname){
 const route=pathname.startsWith('/admin/api/')?pathname.slice(6):pathname;
 return method==='POST'?(actions[route]||(/^\/api\/customers\/[a-f0-9]{64}$/.test(route)?'更新会话 / 保存草稿':null)):null;
}
function shouldRecord(action,info){
 if(!action)return false;
 if(action==='标记为未读')return info.read===false;
 if(action!=='更新会话 / 保存草稿')return true;
 const fields=info.fields||[];
 return fields.some(key=>['status','assigneeId','replyInboxId'].includes(key))||(info.manualSave===true&&fields.includes('draft'));
}
// Explicit allowlist: never persist request bodies, credentials, draft text or addresses.
function details(input,pathname){
 const result={};
 if(typeof input?.read==='boolean')result.read=input.read;
 if(input?.manualSave===true)result.manualSave=true;
 if(/\/customers\/[a-f0-9]{64}$/.test(pathname)&&input?.patch&&typeof input.patch==='object')input=input.patch;
 if(pathname.endsWith('/api/settings/signatures')&&typeof input?.code==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(input.code))result.signatureCode=input.code;
 for(const key of ['customerId','orderId','messageId','inboxId','sourceId','staffId','assigneeId','replyInboxId','id','status','mode','kind','provider','action']){
  const value=input?.[key];if(typeof value==='string'&&value.length<=160)result[key]=value;
 }
 if(Object.hasOwn(input||{},'assigneeId')&&input.assigneeId===null)result.assigneeId='未分配';
 if(Array.isArray(input?.messageIds)){result.messageIds=input.messageIds.filter(v=>typeof v==='string'&&v.length<=80).slice(0,100);result.messageCount=input.messageIds.length;}
 if(Array.isArray(input?.labelIds))result.labelIds=input.labelIds.filter(v=>typeof v==='string'&&v.length<=80).slice(0,100);
 const fields=['country','phone','address','vip','recipient','product','variant','draft','draftText','status','assigneeId','replyInboxId','staffId','labelIds','name','color','text','subject','attachments','password','smtpPassword','apiKey','token','imap','smtp','shopIds','testRecipients','baseUrl','model','apiType','translation','reply','autoClassify'];
 result.fields=fields.filter(key=>Object.hasOwn(input||{},key));
 const match=/\/customers\/([a-f0-9]{64})$/.exec(pathname);if(match)result.customerId=match[1];
 const attachment=/\/api\/(?:attachments|desk\/files)\/([a-f0-9-]+)(?:\/(\d+))?$/.exec(pathname);if(attachment)result.attachmentId=attachment[1]+(attachment[2]?'/'+attachment[2]:'');
 return result;
}
function actionTitle(action,info){if(action!=='更新会话 / 保存草稿')return action;const fields=info.fields||[];return [fields.includes('draft')?'保存草稿':'',fields.includes('status')?'修改会话状态':'',fields.includes('assigneeId')?'分配客服':'',fields.includes('replyInboxId')?'选择回复邮箱':''].filter(Boolean).join('、')||action;}
function actor(identity,admin=false){if(identity?.auth==='password')return{account:identity.name,accountId:identity.username,role:'staff',auth:'password'};return identity?.auth==='access-code'?{account:'共享管理访问码',accountId:'shared-admin',role:'admin',auth:'access-code'}:identity?{account:String(identity.name||'钉钉用户'),accountId:String(identity.unionId||identity.staffId||''),role:admin?'admin':identity.role==='admin'?'admin':'staff',auth:'dingtalk'}:{account:admin?'共享管理访问码':'共享工作台访问码',accountId:admin?'shared-admin':'shared-business',role:admin?'admin':'staff',auth:'access-code'};}
function createOperationLog(filename){
 const db=new DatabaseSync(filename);
 if(filename!==':memory:')fs.chmodSync(filename,0o600);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS operations(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, account TEXT NOT NULL, account_id TEXT NOT NULL, role TEXT NOT NULL, auth TEXT NOT NULL, action TEXT NOT NULL, route TEXT NOT NULL, result TEXT NOT NULL, status INTEGER NOT NULL, details TEXT NOT NULL); CREATE INDEX IF NOT EXISTS operations_at ON operations(at);');
 const insert=db.prepare('INSERT INTO operations(at,account,account_id,role,auth,action,route,result,status,details) VALUES(?,?,?,?,?,?,?,?,?,?)');
 return {
  append(entry){const a=entry.actor;insert.run(entry.at,a.account,a.accountId,a.role,a.auth,entry.action,entry.route,entry.result,entry.status,JSON.stringify(entry.details));},
  list(params){
   const where=[],values=[];
   const before=Number(params.get('before'));if(Number.isSafeInteger(before)&&before>0){where.push('id < ?');values.push(before);}
   const role=params.get('role');if(['admin','staff','unknown'].includes(role)){where.push('role = ?');values.push(role);}
   const result=params.get('result');if(['success','failed','unknown','accepted'].includes(result)){where.push('result = ?');values.push(result);}
   const q=(params.get('q')||'').trim().slice(0,160);if(q){where.push('(instr(account,?)>0 OR instr(account_id,?)>0 OR instr(action,?)>0 OR instr(details,?)>0)');values.push(q,q,q,q);}
   const rows=db.prepare('SELECT * FROM operations'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY id DESC LIMIT 51').all(...values);
   const more=rows.length>50;return{rows:rows.slice(0,50).map(r=>({...r,details:JSON.parse(r.details)})),next:more?rows[49].id:null};
  },close:()=>db.close()
 };
}
module.exports={createOperationLog,operation,details,actor,actionTitle,shouldRecord};
