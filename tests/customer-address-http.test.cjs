'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createCustomerAddressHandler}=require('../backend/customer-address-http.cjs');
test('public routes require exact host and same-origin JSON API, while allowing storefront iframe GET',async t=>{
 let calls=0;const handle=createCustomerAddressHandler({publicOrigin:'https://chat.example.com',basePath:'/maildesk',frameOrigins:['https://shop.example.com'],service:{lookup:async()=>{calls++;return{token:'ok'};}}});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res)){res.writeHead(401);res.end('private');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const request=(path,method='GET',headers={},body='{}')=>new Promise(resolve=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path,method,headers:{host:'chat.example.com',...headers}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data}));});req.end(method==='POST'?body:undefined);});
 const page=await request('/maildesk/customer-address/', 'GET',{'sec-fetch-site':'cross-site'});assert.equal(page.status,200);assert.match(page.headers['content-security-policy'],/frame-ancestors https:\/\/shop.example.com/);assert.equal(page.headers['x-frame-options'],undefined);
 assert.equal((await request('/maildesk/api/bootstrap')).status,401);
 assert.equal((await request('/maildesk/customer-address/api/challenge','POST')).status,404);
 assert.equal((await request('/maildesk/customer-address/api/verify','POST')).status,404);
 assert.equal((await request('/maildesk/customer-address/../api/bootstrap')).status,404);
 assert.equal((await request('/maildesk/customer-address/api/lookup','POST',{origin:'https://evil.example','content-type':'application/json'})).status,403);
 assert.equal((await request('/maildesk/customer-address/api/lookup','POST',{origin:'https://chat.example.com','content-type':'application/json',host:'evil.example'})).status,403);
 assert.equal((await request('/maildesk/customer-address/api/lookup','POST',{origin:'https://chat.example.com','content-type':'application/json'})).status,200);assert.equal(calls,1);
});
test('enabled customer entry leaves employee bootstrap authenticated',async t=>{
 const {createLanProxy}=require('../backend/lan/proxy.cjs');
 const handle=createCustomerAddressHandler({publicOrigin:'https://desk.example',basePath:'/maildesk',service:{}});
 const gateway=createLanProxy({address:'127.0.0.1',port:0,upstreamPort:1,kind:'business',publicOrigin:'https://desk.example',basePath:'/maildesk',dingtalk:{redirectUri:'https://desk.example/maildesk/auth/dingtalk/callback',getUser:()=>null},customerAddress:{handle}});
 await gateway.listen();t.after(()=>gateway.close());
 const get=path=>new Promise(resolve=>{http.get({hostname:'127.0.0.1',port:gateway.server.address().port,path,headers:{host:'desk.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});});
 assert.equal(await get('/maildesk/customer-address/'),200);assert.equal(await get('/maildesk/api/bootstrap'),401);
});
test('forwarded client addresses are ignored unless the direct proxy is configured',async t=>{
 for(const trusted of [false,true]){let received;const handle=createCustomerAddressHandler({publicOrigin:'https://desk.example',trustedProxyAddresses:trusted?['127.0.0.1']:[],service:{lookup:async(i,ip)=>{received=ip;return{};}}});
 const server=http.createServer(handle);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await new Promise(resolve=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/customer-address/api/lookup',method:'POST',headers:{host:'desk.example',origin:'https://desk.example','content-type':'application/json','x-forwarded-for':'spoofed, 203.0.113.9'}},res=>{res.resume();res.on('end',resolve);});req.end('{}');});assert.equal(received,trusted?'203.0.113.9':'127.0.0.1');}finally{await new Promise(r=>server.close(r));}}
});
