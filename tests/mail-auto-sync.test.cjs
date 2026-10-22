const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Store}=require('../backend/database.cjs'),{createMailAutoSync}=require('../backend/mail-auto-sync.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('toggle persists, schedules once, and stops between mailboxes without overlapping cycles',async()=>{
 const store=new Store(':memory:'),timers=new Map();let next=0,release,calls=0,canContinue;
 const options={setTimer:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimer:id=>timers.delete(id)};
 const control=createMailAutoSync(store.db,async enabled=>{calls++;canContinue=enabled;await new Promise(resolve=>release=resolve);},options);
 try{control.start();assert.equal(timers.size,0);assert.throws(()=>control.setEnabled('true'),/INVALID/);
 control.setEnabled(true);assert.equal(timers.size,1);const first=[...timers.values()][0];timers.clear();first.fn();await flush();assert.equal(calls,1);
 control.setEnabled(false);assert.equal(canContinue(),false);control.setEnabled(true);assert.equal(timers.size,0);assert.equal(calls,1);
 release();await flush();assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,60000);
 control.setEnabled(false);assert.equal(timers.size,0);await control.close();
 const restored=createMailAutoSync(store.db,async()=>{}, {...options,defaultEnabled:true});assert.equal(restored.enabled(),false);restored.setEnabled(true);await restored.close();
 const restarted=createMailAutoSync(store.db,async()=>{},options);assert.equal(restarted.enabled(),true);await restarted.close();
 }finally{await control.close();store.close();}
});
test('scheduler recovers after a failed cycle',async()=>{const store=new Store(':memory:');let fn,errors=0;const control=createMailAutoSync(store.db,async()=>{throw Error('failure');},{defaultEnabled:true,setTimer:f=>{fn=f;return 1;},clearTimer:()=>{},onError:()=>errors++});try{control.start();const first=fn;first();await flush();assert.equal(errors,1);assert.notEqual(fn,first);}finally{await control.close();store.close();}});
test('settings HTTP switch updates immediately and survives service restart without starting other jobs',async()=>{
 const {createPilot}=require('../backend/pilot.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-mail-api-'));let app=createPilot({directory:dir,port:0,autoSync:false});
 async function request(route,input,token){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path:route,method:input===undefined?'GET':'POST',headers:{Host:'127.0.0.1:0',Origin:'http://127.0.0.1:0','Content-Type':'application/json',Authorization:'Bearer '+token}},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve({status:r.statusCode,data:JSON.parse(body)}));});req.on('error',reject);req.end(input===undefined?undefined:JSON.stringify(input));});}
 try{await app.listen();let token=(await request('/api/bootstrap')).data.token;assert.equal((await request('/api/settings',undefined,token)).data.autoSync,false);
 assert.equal((await request('/api/settings/auto-sync',{enabled:'true'},token)).status,400);
 assert.equal((await request('/api/settings/auto-sync',{enabled:true},token)).data.enabled,true);assert.equal((await request('/api/settings',undefined,token)).data.autoSync,true);
 await app.close();app=createPilot({directory:dir,port:0,autoSync:false});await app.listen();token=(await request('/api/bootstrap')).data.token;assert.equal((await request('/api/settings',undefined,token)).data.autoSync,true);
 assert.equal((await request('/api/settings/auto-sync',{enabled:false},token)).data.enabled,false);assert.equal((await request('/api/status',undefined,token)).data.autoSync.enabled,false);
 assert.equal(app.store.db.prepare('SELECT count(*) n FROM sync_runs').get().n,0);
 const {permitted,permittedAdmin}=require('../backend/lan/proxy.cjs');assert.equal(permittedAdmin('POST','/api/settings/auto-sync'),true);assert.equal(permitted('POST','/api/settings/auto-sync'),false);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
