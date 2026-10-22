'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createOperationLog,details,operation,shouldRecord}=require('../backend/operation-log.cjs');
const {createLanProxy}=require('../backend/lan/proxy.cjs');
test('logs persist, filter and paginate without duplicating entries; secrets are omitted',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operation-log-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const filename=path.join(dir,'audit.sqlite');let log=createOperationLog(filename);
 const data=details({customerId:'customer',password:'PASSWORD_SECRET',apiKey:'API_SECRET',draft:'PRIVATE_MESSAGE',address:'PRIVATE_ADDRESS',status:'done'},'/api/desk/profile');
 const draft=details({patch:{draft:'NEVER_LOG_DRAFT',assigneeId:'staff-2'}},'/api/customers/'+ 'a'.repeat(64));assert.equal(draft.assigneeId,'staff-2');assert(draft.fields.includes('draft'));assert.doesNotMatch(JSON.stringify(draft),/NEVER_LOG_DRAFT/);
 assert.deepEqual(data.fields,['address','draft','status','password','apiKey']);assert.doesNotMatch(JSON.stringify(data),/SECRET|PRIVATE/);
 for(let i=0;i<53;i++)log.append({at:new Date().toISOString(),actor:{account:'财布',accountId:'union-1',role:'admin',auth:'dingtalk'},action:'修改顾客资料',route:'/api/desk/profile',result:'success',status:200,details:data});
 log.close();log=createOperationLog(filename);try{const a=log.list(new URLSearchParams('q=财布&role=admin'));assert.equal(a.rows.length,50);const b=log.list(new URLSearchParams('before='+a.next));assert.equal(b.rows.length,3);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,53);assert.equal(log.list(new URLSearchParams('role=staff')).rows.length,0);assert.equal(log.list(new URLSearchParams('result=failed')).rows.length,0);}finally{log.close();}
});
test('gateway binds actors to authenticated sessions, restricts logs to admins and preserves identities on restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-gateway-'));
 const upstream=http.createServer((req,res)=>{let body='';req.on('data',v=>body+=v);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/send'?{status:'unknown'}:{saved:true}));});});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 let adminRole='admin';const dingtalk={getUser:i=>i?{...i,role:i.unionId==='admin-1'?adminRole:'staff'}:null,redirectUri:'https://desk.example/maildesk/auth/dingtalk/callback',finish:async params=>params.get('authCode')==='admin'?{name:'财布',unionId:'admin-1',role:'admin'}:{name:'客服小张',unionId:'staff-1',role:'staff'}};
 const options={address:'127.0.0.1',port:0,upstreamPort:upstream.address().port,kind:'business',code:'business-secret-123',adminCode:'admin-secret-123',adminUpstreamPort:upstream.address().port,publicOrigin:'https://desk.example',basePath:'/maildesk',dingtalk,sessionFile:path.join(dir,'sessions.json'),auditFile:path.join(dir,'audit.sqlite')};
 let gateway=createLanProxy(options);await gateway.listen();
 t.after(async()=>{await gateway.close();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const request=(route,{cookie='',body,headers={}}={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:gateway.server.address().port,path:'/maildesk'+route,method:body===undefined?'GET':'POST',headers:{Host:'desk.example',Cookie:cookie,Origin:'https://desk.example','Content-Type':'application/json',...headers}},res=>{let text='';res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});
 const cookies=r=>r.headers['set-cookie'].filter(v=>v.startsWith('maildesk_lan_')).map(v=>v.split(';')[0]).join('; ');
 const staff=cookies(await request('/auth/dingtalk/callback?authCode=staff'));
 const admin=cookies(await request('/auth/dingtalk/callback?authCode=admin'));
 assert.equal((await request('/admin/api/operation-logs')).status,401);
 assert.equal((await request('/admin/api/operation-logs',{cookie:staff})).status,403);
 assert.equal((await request('/api/operation-logs',{cookie:staff})).status,403);
 const customerPath='/api/customers/'+'a'.repeat(64);
 await request('/api/desk/customers/'+'a'.repeat(64),{cookie:staff});
 await request('/api/reply-route',{cookie:staff,body:'{"messageId":"M-1"}'});
 await request('/api/read',{cookie:staff,body:'{"messageIds":["M-1"]}'});
 await request(customerPath,{cookie:staff,body:JSON.stringify({patch:{draft:'automatic draft'}})});
 assert.equal(JSON.parse((await request('/admin/api/operation-logs',{cookie:admin})).text).rows.length,0);
 await request(customerPath,{cookie:staff,body:JSON.stringify({patch:{draft:'manual draft'},manualSave:true})});
 await request(customerPath,{cookie:staff,body:JSON.stringify({patch:{status:'done'}})});
 const manualRows=JSON.parse((await request('/admin/api/operation-logs',{cookie:admin})).text).rows;
 assert.equal(manualRows.length,2);assert(manualRows.some(r=>r.action==='保存草稿'));assert(manualRows.some(r=>r.action==='修改会话状态'));
 await request('/api/desk/profile',{cookie:staff,body:JSON.stringify({customerId:'C-1',vip:true,password:'NEVER_STORE_THIS',actor:'财布',role:'admin'}),headers:{'x-user-name':'forged-admin','x-user-role':'admin'}});
 await request('/api/send',{cookie:staff,body:JSON.stringify({messageId:'M-1',text:'PRIVATE_EMAIL'})});
 await request('/admin/api/settings/ai',{cookie:admin,body:JSON.stringify({apiKey:'SECRET_AI_KEY',model:'test'})});
 let rows=JSON.parse((await request('/admin/api/operation-logs',{cookie:admin})).text).rows;
 const profile=rows.find(r=>r.action==='修改顾客资料');assert.equal(profile.account,'客服小张');assert.equal(profile.role,'staff');assert.equal(profile.account_id,'staff-1');assert.equal(profile.details.customerId,'C-1');assert.equal(profile.result,'success');
 assert.equal(rows.find(r=>r.action==='发送邮件').result,'unknown');
 assert.equal(rows.find(r=>r.action==='修改 AI 配置').account,'财布');assert.doesNotMatch(JSON.stringify(rows),/NEVER_STORE_THIS|SECRET_AI_KEY|PRIVATE_EMAIL|authCode/);
 await gateway.close();gateway=createLanProxy(options);await gateway.listen();
 await request('/admin/api/settings/sending',{cookie:admin,body:JSON.stringify({mode:'test'})});
 rows=JSON.parse((await request('/admin/api/operation-logs?role=admin&q='+encodeURIComponent('财布'),{cookie:admin})).text).rows;assert(rows.length>0);assert(rows.every(r=>r.account==='财布'&&r.role==='admin'));assert(rows.some(r=>r.action==='修改发信策略'));
 assert.equal((await request('/admin/login',{body:'code=admin-secret-123',headers:{'Content-Type':'application/x-www-form-urlencoded'}})).status,403);
 adminRole='staff';assert.equal((await request('/admin/api/operation-logs',{cookie:admin})).status,403);adminRole='admin';
 await request('/admin/logout',{cookie:admin,body:''});assert.equal((await request('/admin/api/operation-logs',{cookie:admin})).status,401);
});

test('only manual mutation routes are logged, including explicit draft saves',()=>{
 for(const route of ['/api/reply-route','/api/desk/assistant','/api/desk/translate','/admin/api/settings/test','/admin/login','/admin/logout'])assert.equal(operation('POST',route),null);
 for(const route of ['/auth/dingtalk/callback','/admin/api/operation-logs','/api/desk/customers/'+ 'a'.repeat(64)])assert.equal(operation('GET',route),null);
 const action=operation('POST','/api/customers/'+'a'.repeat(64));
 assert.equal(shouldRecord(action,{fields:['draft']}),false);
 assert.equal(shouldRecord(action,{fields:['draft'],manualSave:true}),true);
 assert.equal(shouldRecord(action,{fields:['status']}),true);
 assert.equal(shouldRecord(action,{fields:['assigneeId']}),true);
});

test('manual unread is logged while automatic read is ignored',()=>{const action=operation('POST','/api/read');assert.equal(shouldRecord(action,details({messageIds:['a']},'/api/read')),false);assert.equal(shouldRecord(action,details({messageIds:['a'],read:false},'/api/read')),true);});
