'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createLanProxy}=require('../backend/lan/proxy.cjs');
const {createDingtalk}=require('../backend/dingtalk.cjs');
const origin='https://desk.example.test',base='/maildesk';
function request(port,url,{method='GET',cookie,body,headers={}}={}){
 return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:base+url,method,headers:{Host:'desk.example.test',...(cookie?{Cookie:cookie}:{}),...(method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{}),...headers}},res=>{let text='';res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));});req.on('error',reject);req.end(body);});
}
test('DingTalk-only server authentication and admin authorization',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maildesk-access-test-'));
 const usersFile=path.join(dir,'users.json'),sessionFile=path.join(dir,'sessions.json');
 const users=[{unionId:'admin-id',corpId:'company',name:'喝点',role:'admin'},{unionId:'staff-id',corpId:'company',name:'客服',role:'staff'}];
 fs.writeFileSync(usersFile,JSON.stringify(users));
 let now=Date.now();
 const tokens={admin:'a'.repeat(64),staff:'b'.repeat(64),legacy:'c'.repeat(64),unknown:'d'.repeat(64),expired:'e'.repeat(64),wrongCorp:'f'.repeat(64),oldAdmin:'1'.repeat(64)};
 const cookie=key=>'maildesk_lan_business='+tokens[key];
 fs.writeFileSync(sessionFile,JSON.stringify({sessions:Object.entries(tokens).filter(([k])=>k!=='oldAdmin').map(([k,v])=>[v,now+(k==='expired'?-1:60000)]),adminSessions:[[tokens.oldAdmin,now+60000]],identities:[[tokens.admin,{...users[0],role:'staff'}],[tokens.staff,{...users[1],role:'admin'}],[tokens.unknown,{unionId:'missing',corpId:'company',role:'admin'}],[tokens.expired,users[0]],[tokens.wrongCorp,{...users[0],corpId:'another-company'}]]}));
 const fetchImpl=async(url,options)=>{
  if(url.endsWith('userAccessToken')){const code=JSON.parse(options.body).code;return {ok:true,json:async()=>({corpId:code==='foreign'?'another-company':'company',accessToken:code})};}
  const id=options.headers['x-acs-dingtalk-access-token'];return {ok:true,json:async()=>({unionId:id==='admin'?'admin-id':id==='new'?'new-id':'staff-id',nick:id==='admin'?'管理员新昵称':id==='new'?'喝点':'客服'})};
 };
 const dingtalk=createDingtalk({clientId:'app',clientSecret:'secret',corpId:'company',redirectUri:origin+base+'/auth/dingtalk/callback',filename:usersFile,fetchImpl,clock:()=>now});
 const forwarded=[];
 const upstream=http.createServer((req,res)=>{forwarded.push({method:req.method,path:req.url});req.resume();if(req.url==='/config'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><head><script src="/settings/app.js"></script></head><body>settings</body></html>');}else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/api/bootstrap'?{token:'local-token'}:{ok:true}));}});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const options={address:'127.0.0.1',port:0,upstreamPort:upstream.address().port,adminUpstreamPort:upstream.address().port,kind:'business',publicOrigin:origin,basePath:base,dingtalk,sessionFile,clock:()=>now,sessionMs:60000};
 let proxy=createLanProxy(options);await proxy.listen();
 const call=(url,options)=>request(proxy.server.address().port,url,options);
 t.after(async()=>{await proxy.close();await new Promise(resolve=>upstream.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});

 await t.test('public server fails closed without DingTalk',()=>{assert.throws(()=>createLanProxy({...options,dingtalk:null}),/DINGTALK_REQUIRED/);});
 await t.test('login page contains only DingTalk, including settings login',async()=>{
  for(const url of ['/','/config','/admin/config']){const r=await call(url);assert.equal(r.status,200);assert.match(r.text,/href="\/maildesk\/auth\/dingtalk\/login"/);assert.doesNotMatch(r.text,/访问码|name="code"|lan-login|admin\/login/);}
 });
 await t.test('both former code login endpoints and self-promotion are disabled',async()=>{
  const before=forwarded.length;
  for(const url of ['/lan-login','/admin/login','/admin/bind-dingtalk'])for(const key of [null,'staff','admin']){const r=await call(url,{method:'POST',cookie:key?cookie(key):undefined,body:'code=old-code'});assert.equal(r.status,403);assert.equal(r.json().error,'DINGTALK_LOGIN_ONLY');assert.equal(r.headers['set-cookie'],undefined);}
  assert.equal(forwarded.length,before);
 });
 await t.test('old code, removed identity, foreign company, and expired sessions are rejected',async()=>{
  for(const key of ['legacy','unknown','expired','wrongCorp'])assert.equal((await call('/api/bootstrap',{cookie:cookie(key)})).status,401);
  assert.equal((await call('/admin/api/settings',{cookie:'maildesk_lan_admin='+tokens.oldAdmin})).status,401);
  const saved=JSON.parse(fs.readFileSync(sessionFile));assert.equal(saved.sessions.length,2);assert.equal(saved.adminSessions.length,0);
 });
 await t.test('staff can use workbench but cannot access any settings route, including writes',async()=>{
  assert.equal((await call('/api/desk/conversations',{cookie:cookie('staff')})).status,200);
  const meta=(await call('/api/desk/meta',{cookie:cookie('staff')})).json();assert.equal(meta.configUrl,null);assert.equal(meta.currentUser.role,'staff');
  const before=forwarded.length;
  for(const url of ['/config','/accounts','/admin','/admin/','/admin/config','/admin/settings/app.js','/admin/api/bootstrap','/admin/api/settings','/admin/api/status','/api/settings','/settings/app.js'])assert.equal((await call(url,{cookie:cookie('staff')})).status,403,url);
  for(const url of ['/admin/api/settings/ai','/admin/api/settings/mailbox','/admin/api/settings/sending','/admin/api/settings/test','/admin/api/accounts','/admin/api/sync','/api/settings/ai','/api/accounts'])assert.equal((await call(url,{method:'POST',cookie:cookie('staff'),body:'{}'})).status,403,url);
  assert.equal(forwarded.length,before);
 });
 await t.test('current registered admin role overrides cached staff role and grants settings',async()=>{
  const meta=(await call('/api/desk/meta',{cookie:cookie('admin')})).json();assert.equal(meta.configUrl,base+'/config');assert.deepEqual(meta.currentUser,{name:'喝点',role:'admin'});
  const redirect=await call('/config',{cookie:cookie('admin')});assert.equal(redirect.status,303);assert.equal(redirect.headers.location,base+'/admin/config');
  const page=await call('/admin/config',{cookie:cookie('admin')});assert.equal(page.status,200);assert.match(page.text,/\/maildesk\/admin\/settings\/app.js/);assert.doesNotMatch(page.text,/bind-dingtalk/);
  assert.equal((await call('/admin/api/settings',{cookie:cookie('admin')})).json().serverManaged,true);
  for(const url of ['/admin/api/settings/ai','/admin/api/settings/mailbox','/admin/api/settings/sending','/admin/api/settings/test','/admin/api/accounts','/admin/api/sync'])assert.equal((await call(url,{method:'POST',cookie:cookie('admin'),body:'{}'})).status,200);
  assert.equal((await call('/admin/api/settings/ai',{method:'POST',cookie:cookie('admin'),headers:{Origin:'https://evil.test'},body:'{}'})).status,403);
 });
 async function oauth(code){
  const start=await call('/auth/dingtalk/login');assert.equal(start.status,303);const state=new URL(start.headers.location).searchParams.get('state');const browser=start.headers['set-cookie'][0].split(';')[0];
  const url='/auth/dingtalk/callback?state='+state+'&authCode='+code;
  const response=await call(url,{cookie:browser,headers:{'sec-fetch-site':'cross-site'}});return {response,url,browser};
 }
 let newSession;
 await t.test('DingTalk callback, state validation, and company boundary still work',async()=>{
  const result=await oauth('admin');assert.equal(result.response.status,200);newSession=result.response.headers['set-cookie'].find(x=>x.startsWith('maildesk_lan_business=')).split(';')[0];
  assert.equal((await call('/admin/api/settings',{cookie:newSession})).status,200);
  const replay=await call(result.url,{cookie:result.browser});assert.equal(replay.status,403);assert.doesNotMatch(replay.text,/访问码|lan-login/);
  assert.equal((await oauth('foreign')).response.status,403);
 });
 await t.test('nickname changes keep identity, and a new user called 喝点 gets no admin role',async()=>{
  assert.equal(dingtalk.getUser(users[0]).role,'admin');assert.equal(dingtalk.getUser(users[0]).name,'管理员新昵称');
  const result=await oauth('new');const newUserCookie=result.response.headers['set-cookie'].find(x=>x.startsWith('maildesk_lan_business=')).split(';')[0];
  assert.equal((await call('/admin/api/settings',{cookie:newUserCookie})).status,403);
  assert.equal(dingtalk.getUser({unionId:'new-id',corpId:'company'}).role,'staff');
 });
 await t.test('DingTalk sessions survive restart; persisted role changes take effect',async()=>{
  await proxy.close();proxy=createLanProxy(options);await proxy.listen();assert.equal((await call('/admin/api/settings',{cookie:newSession})).status,200);
  const savedUsers=JSON.parse(fs.readFileSync(usersFile));savedUsers.find(x=>x.unionId==='admin-id').role='staff';fs.writeFileSync(usersFile,JSON.stringify(savedUsers));
  const updated=createDingtalk({clientId:'app',clientSecret:'secret',corpId:'company',redirectUri:options.dingtalk.redirectUri,filename:usersFile,fetchImpl,clock:()=>now});
  await proxy.close();proxy=createLanProxy({...options,dingtalk:updated});await proxy.listen();assert.equal((await call('/admin/api/settings',{cookie:newSession})).status,403);
  await proxy.close();proxy=createLanProxy(options);await proxy.listen();
 });
 await t.test('logout revokes the business session as well as admin access',async()=>{
  assert.equal((await call('/admin/logout',{method:'POST',cookie:newSession})).status,303);
  assert.equal((await call('/api/bootstrap',{cookie:newSession})).status,401);assert.equal((await call('/admin/api/settings',{cookie:newSession})).status,401);
 });
 await t.test('session expiry is enforced for settings and workbench',async()=>{
  now+=120000;
  assert.equal((await call('/api/bootstrap',{cookie:cookie('admin')})).status,401);
  assert.equal((await call('/admin/api/settings',{cookie:cookie('admin')})).status,401);
 });
});
