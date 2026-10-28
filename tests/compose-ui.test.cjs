const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('new compose keeps the same payload during pending/unknown retries and does not navigate the current customer',async()=>{
 const source=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8');const a=source.indexOf('function emptyCompose('),b=source.indexOf('function openCompose(',a);assert.ok(a>=0&&b>a,'compose model must exist');
 let release,calls=[],seq=0;const c=vm.createContext({state:{id:'current',meta:{demo:false}},requestUUID:()=>String(++seq),api:async(path,payload)=>{calls.push(payload);return new Promise(r=>release=r);},toast(){},errorText:e=>e.message,renderCompose(){},updateComposeButton(){},FileReader:class{},Promise});
 vm.runInContext(source.slice(a,b),c);vm.runInContext("composeDraft.to='test@example.com';composeDraft.subject='Hello';composeDraft.text='Body';composeDraft.inboxId='inbox';",c);
 const first=c.submitCompose();await new Promise(r=>setImmediate(r));await c.submitCompose();assert.equal(calls.length,1);release({status:'unknown',customerId:'new'});await first;assert.equal(c.state.id,'current');
 const retry=c.submitCompose();await new Promise(r=>setImmediate(r));assert.equal(calls[1],calls[0]);release({status:'accepted',customerId:'new'});await retry;assert.equal(c.state.id,'current');assert.equal(vm.runInContext('composeDraft.result.status',c),'accepted');
});
test('an ambiguous send retains its UUID after permission/configuration rejection',async()=>{
 const source=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8');const c=vm.createContext({requestUUID:()=> 'new',api:async()=>{throw Error('MAILBOX_FORBIDDEN');},toast(){},errorText:e=>e.message,renderCompose(){},updateComposeButton(){},Promise});vm.runInContext(source.slice(source.indexOf('function emptyCompose('),source.indexOf('function openCompose(')),c);
 vm.runInContext("composeDraft.payload={requestId:'original'};composeDraft.result={status:'unknown'};",c);await c.submitCompose();assert.equal(vm.runInContext('composeDraft.payload.requestId',c),'original');
 c.holdCompose();assert.equal(vm.runInContext('composeHeld[0].payload.requestId',c),'original');assert.equal(vm.runInContext('composeDraft.payload',c),null);
});
test('rapid signature clicks insert once and removal preserves the body',async()=>{
 const source=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8');const waiting=[];const c=vm.createContext({state:{meta:{signature:{text:'Best regards,\nTest\nCustomer Support Team'}}},refreshMeta:()=>new Promise(r=>waiting.push(r)),renderCompose(){},toast(){}});
 vm.runInContext(source.slice(source.indexOf('function emptyCompose('),source.indexOf('function openCompose(')),c);vm.runInContext(source.slice(source.indexOf('async function toggleComposeSignature('),source.indexOf('function updateComposeButton(')),c);
 vm.runInContext("composeDraft.text='Hello';",c);const a=c.toggleComposeSignature(),b=c.toggleComposeSignature();waiting.forEach(r=>r());await Promise.all([a,b]);assert.equal(vm.runInContext('composeDraft.text',c),'Hello\n\nBest regards,\nTest\nCustomer Support Team');await c.toggleComposeSignature();assert.equal(vm.runInContext('composeDraft.text',c),'Hello');
});
