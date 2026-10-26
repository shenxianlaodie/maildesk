'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../backend/database.cjs');const {createPilot}=require('../backend/pilot.cjs');const {createLanProxy}=require('../backend/lan/proxy.cjs');
for(const basePath of ['', '/maildesk'])test('HTTPS gateway requires current DingTalk administrator and scopes paths at '+basePath,async()=>{
 const app=createPilot({store:new Store(':memory:'),vault:{get:()=>({}),status:()=>({})},port:19591,autoSync:false});
 let role='admin';const dingtalk={redirectUri:'https://desk.example.com'+basePath+'/auth/dingtalk/callback',getUser:i=>i?{...i,role}:null,finish:async()=>({name:'管理员',corpId:'corp',unionId:'a',role}),start:()=>({url:'https://login.example',browser:'state'})};
 const gateway=createLanProxy({address:'127.0.0.1',port:19592,upstreamPort:19591,kind:'business',adminUpstreamPort:19591,publicOrigin:'https://desk.example.com',basePath,dingtalk});
 const request=(route,{method='GET',headers={},body=''}={})=>new Promise((resolve,reject)=>{const req=http.request({agent:false,hostname:'127.0.0.1',port:19592,path:basePath+route,method,headers:{Host:'desk.example.com',...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});
 const ownId=require('../backend/staff-identity.cjs').staffId({corpId:'corp',unionId:'a'});app.store.addStaff({id:ownId,name:'Self'});app.store.addStaff({id:'other-agent',name:'Other'});
 await app.listen();await gateway.listen();try{
 assert.equal((await request('/api/bootstrap')).status,401);assert.equal((await request('/',{headers:{Host:'evil.example'}})).status,403);
 assert.equal((await request('/lan-login',{method:'POST',headers:{Origin:'https://desk.example.com'}})).status,403);
 const login=await request('/auth/dingtalk/callback?authCode=test');const cookie=login.headers['set-cookie'].find(c=>c.startsWith('maildesk_lan_business=')).split(';')[0];assert.match(login.headers['set-cookie'][1],/Secure/);
 const html=await request('/',{headers:{Cookie:cookie}});assert.equal(html.status,200);assert(html.text.includes('src="'+basePath+'/desk/app.js"'));
 const bootstrap=await request('/api/bootstrap',{headers:{Cookie:cookie}});const token=JSON.parse(bootstrap.text).token;
 const config=await request('/admin/config',{headers:{Cookie:cookie}});assert(config.text.includes('src="'+basePath+'/admin/settings/app.js"'));assert(!config.text.includes('bind-dingtalk'));
 const settings=await request('/admin/api/settings',{headers:{Cookie:cookie,Authorization:'Bearer '+token}});assert.equal(settings.status,200);assert.equal(JSON.parse(settings.text).serverManaged,true);
 const sync=await request('/admin/api/sync',{method:'POST',headers:{Cookie:cookie,Authorization:'Bearer '+token,Origin:'https://desk.example.com','Content-Type':'application/json'},body:JSON.stringify({provider:'zoho'})});assert.equal(sync.status,400);
 const adminStats=JSON.parse((await request('/api/desk/reply-stats',{headers:{Cookie:cookie,Authorization:'Bearer '+token}})).text);assert.ok(adminStats.rows.some(r=>r.id==='other-agent'));
 role='staff';const ownStats=JSON.parse((await request('/api/desk/reply-stats?staffId=other-agent&role=admin',{headers:{Cookie:cookie,Authorization:'Bearer '+token,'x-maildesk-staff':'other-agent','x-maildesk-role':'admin'}})).text);assert.equal(ownStats.rows.length,1);assert.equal(ownStats.rows[0].id,ownId);assert.equal(ownStats.total,0);
 app.store.db.prepare('INSERT INTO templates VALUES(?,?,?,?,?)').run('sort-test','Sort test','','test',new Date().toISOString());
 const sorted=await request('/api/desk/template-order',{method:'POST',headers:{Cookie:cookie,Authorization:'Bearer '+token,Origin:'https://desk.example.com','Content-Type':'application/json','x-maildesk-staff':'other-agent'},body:JSON.stringify({ids:['sort-test'],actor:'other-agent'})});assert.equal(sorted.status,200);assert.equal(JSON.parse(sorted.text).templateOrder[0],'sort-test');
 const ownOrder=await request('/api/desk/template-order',{headers:{Cookie:cookie,Authorization:'Bearer '+token}});assert.equal(ownOrder.status,200);assert.equal(JSON.parse(ownOrder.text).templateOrder[0],'sort-test');assert.ok(app.store.db.prepare('SELECT value FROM app_settings WHERE key=?').get('template_order:'+ownId));assert.equal(app.store.db.prepare('SELECT value FROM app_settings WHERE key=?').get('template_order:other-agent'),undefined);


assert.equal((await request('/admin/api/settings',{headers:{Cookie:cookie,Authorization:'Bearer '+token}})).status,403);role='admin';
 const logout=await request('/admin/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://desk.example.com'}});assert.equal(logout.status,303);assert.equal((await request('/admin/api/settings',{headers:{Cookie:cookie}})).status,401);
 }finally{await gateway.close();await app.close();}
});
test('DingTalk sessions survive restart and expire after seven days; stale shared sessions are removed',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'server-sessions-'));let now=Date.now();
 const dingtalk={redirectUri:'https://desk.example/maildesk/auth/dingtalk/callback',getUser:i=>i?.unionId==='a'?i:null,finish:async()=>({name:'管理员',corpId:'corp',unionId:'a',role:'admin'})};
 const options={address:'127.0.0.1',port:0,upstreamPort:1,adminUpstreamPort:1,kind:'business',publicOrigin:'https://desk.example',basePath:'/maildesk',dingtalk,sessionMs:7*86400000,sessionFile:path.join(directory,'sessions.json'),clock:()=>now};
 let gateway=createLanProxy(options);await gateway.listen();t.after(async()=>{await gateway.close();fs.rmSync(directory,{recursive:true,force:true});});
 const request=(route,cookie='')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:gateway.server.address().port,path:'/maildesk'+route,headers:{Host:'desk.example',Cookie:cookie}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.end();});
 const login=await request('/auth/dingtalk/callback?authCode=test'),cookie=login.headers['set-cookie'][1].split(';')[0];assert.match(login.headers['set-cookie'][1],/Max-Age=604800/);
 await gateway.close();now+=6*86400000;gateway=createLanProxy(options);await gateway.listen();assert.equal((await request('/admin/api/settings',cookie)).status,502);
 now+=86400001;assert.equal((await request('/admin/api/settings',cookie)).status,401);
});
