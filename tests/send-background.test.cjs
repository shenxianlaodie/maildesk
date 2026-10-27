const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const state={id:'a',draft:'reply A',orderId:'order A',files:[],meta:{demo:false},loadSeq:1},calls=[],waiting=[],selected=[],selectors=[],controls={};
 const context=vm.createContext({state,Map,Promise,FileReader:class{},drafts:new Map(),replySignatures:new Map(),toast:()=>{},replyBody:()=>state.draft,lastInbound:()=>({id:'message '+state.id}),requestUUID:()=> 'request '+state.id,
 $:s=>controls[state.id+s]||=(s==='#reply-inbox'?{value:'inbox '+state.id}: {disabled:false}),
 $$:s=>{selectors.push(s);return [context.$('#send')];},saveDraft:async()=>{},renderWorkspace:()=>{context.$('#send').disabled=false;},selectCustomer:async id=>{selected.push(id);},
 api:async(route,input)=>{calls.push(input);return new Promise((resolve,reject)=>waiting.push({resolve,reject}));}});
 vm.runInContext(source.slice(source.indexOf('const sendingReplies='),source.indexOf('function refundEstimate')),context);
 return {context,state,calls,waiting,selected,selectors,send:()=>context.sendReply()};
}
test('send locks only composer and suppresses double clicks before awaiting draft save',async()=>{
 const f=fixture(),p=f.send();await f.send();await tick();assert.equal(f.calls.length,1);assert.ok(f.selectors.every(s=>!s.includes('.workspace')));f.waiting[0].resolve({status:'accepted'});await p;
});
test('switching customer during send preserves destination, draft, files and selection',async()=>{
 const f=fixture(),p=f.send();f.state.id='b';f.state.draft='reply B';f.state.orderId='order B';f.state.files=['file B'];f.state.requestId='request B';await tick();
 assert.equal(f.calls[0].text,'reply A');assert.equal(f.calls[0].messageId,'message a');assert.equal(f.calls[0].inboxId,'inbox a');assert.equal(f.calls[0].orderId,'order A');
 f.waiting[0].resolve({status:'accepted'});await p;assert.equal(f.state.draft,'reply B');assert.deepEqual(f.state.files,['file B']);assert.equal(f.state.requestId,'request B');assert.deepEqual(f.selected,[]);
});
test('another customer can send while the first reply is pending',async()=>{
 const f=fixture(),a=f.send();f.state.id='b';f.state.draft='reply B';f.state.requestId=null;const b=f.send();await tick();assert.equal(f.calls.length,2);
 f.waiting[0].resolve({status:'accepted'});await a;assert.equal(f.context.$('#send').disabled,true);f.waiting[1].resolve({status:'accepted'});await b;
});
for(const status of ['failed','unknown'])test(status+' keeps draft and reuses request id',async()=>{
 const f=fixture(),p=f.send();await tick();f.waiting[0].resolve({status});await p;assert.equal(f.state.draft,'reply A');const again=f.send();await tick();assert.equal(f.calls[0].requestId,f.calls[1].requestId);f.waiting[1].resolve({status});await again;
});
test('navigation and unload guards use per-customer versus global pending state',()=>{
 assert.ok(!source.includes("if(sendingReplies.has(state.id))return toast('正在保存回复，请稍候。');await selectCustomer"));
 assert.ok(source.includes('state.dirty||sendingReplies.size'));
 assert.ok(source.includes('renderFiles();lockSendingComposer();'));
});
test('network errors unlock composer without losing draft or request identity',async()=>{
 const f=fixture(),p=f.send();await tick();f.waiting[0].reject(Error('offline'));await assert.rejects(p,/offline/);
 assert.equal(f.state.draft,'reply A');assert.equal(f.context.$('#send').disabled,false);
 const retry=f.send();await tick();assert.equal(f.calls[1].requestId,f.calls[0].requestId);f.waiting[1].resolve({status:'unknown'});await retry;
});
