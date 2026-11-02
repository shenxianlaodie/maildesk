const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(process.env.MAILDESK_TEST_APP||path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const d={customer:{id:'a'},work:{revision:1,status:'pending',draft:''}},state={id:'a',detail:d,list:{rows:[{id:'a',status:'pending',unreplied:1}]},filter:'all',saveQueue:Promise.resolve(),dirty:false},buttons={},calls=[],waiters=[],messages=[];
 let renders=0,lists=0;
 const context=vm.createContext({state,d,Map,Promise,saveTimer:null,clearTimeout, drafts:new Map(),$:()=>buttons[state.id]||=( {disabled:false,setAttribute(){},querySelector(){return this;}}),run:fn=>fn,saveDraft:async()=>{},api:(route,input)=>{calls.push({route,input});return new Promise((resolve,reject)=>waiters.push({resolve,reject}));},renderWorkspace:()=>renders++,loadList:()=>{lists++;return new Promise(()=>{});},renderList:()=>{},toast:m=>messages.push(m),icon:()=>'',updateRepliedRow:()=>{throw Error('must preserve unanswered state');}});
 const start=source.indexOf('const markingDone=');if(start>=0)vm.runInContext(source.slice(start,source.indexOf('async function markUnread(',start)),context);
 const bind=source.slice(source.indexOf("$('#mark-done').onclick="),source.indexOf("$('#more').onclick="));vm.runInContext(bind,context);
 return {state,d,context,calls,waiters,messages,buttons,get renders(){return renders;},get lists(){return lists;},click:()=>buttons[state.id].onclick(),bind:()=>vm.runInContext(bind,context)};
}
test('mark done updates only state controls, without a workspace rebuild or full list query',async()=>{
 const f=fixture(),p=f.click();await tick();f.waiters[0].resolve({revision:2,status:'done',draft:''});await tick();assert.equal(f.renders,0);assert.equal(f.lists,0);assert.equal(f.state.list.rows[0].status,'done');assert.equal(f.state.list.rows[0].unreplied,1);await p;
});
test('double clicks submit once and only disable the current status button',async()=>{
 const f=fixture(),p=f.click();const again=f.click();await tick();assert.equal(f.calls.length,1);assert.equal(f.buttons.a.disabled,true);f.waiters[0].resolve({revision:2,status:'done'});await p;await again;assert.equal(f.buttons.a.disabled,false);
});
test('switching customers during a mark does not rebuild or replace the current conversation',async()=>{
 const f=fixture(),p=f.click();await tick();f.state.id='b';const b=f.state.detail={customer:{id:'b'},work:{revision:9,status:'pending'}};f.waiters[0].resolve({revision:2,status:'done'});await tick();assert.equal(f.renders,0);assert.equal(f.state.detail,b);assert.equal(b.work.status,'pending');await p;
});
test('failed status saves keep old state and unlock for retry',async()=>{
 const f=fixture(),p=f.click();await tick();f.waiters[0].reject(Error('offline'));await assert.rejects(p,/offline/);assert.equal(f.d.work.status,'pending');assert.equal(f.buttons.a.disabled,false);const retry=f.click();await tick();assert.equal(f.calls.length,2);f.waiters[1].resolve({revision:2,status:'done'});await retry;
});
function useRealDraftSave(f){const start=source.indexOf('async function saveDraft(');vm.runInContext(source.slice(start,source.indexOf('\n',start)),f.context);}
function useRealNavigation(f){Object.assign(f.context,{stopAddressWatch(){},leavePendingRead(){},stopTrackingObservers(){},customerController:null,AbortController,$$:()=>[],errorText:e=>e.message,retryReplies:new Map()});f.state.loadSeq=0;const start=source.indexOf('async function selectCustomer(');vm.runInContext(source.slice(start,source.indexOf('\n',start)),f.context);}
test('typing during a status save does not block navigation; reentry waits for that customer writes',async()=>{
 const f=fixture();useRealDraftSave(f);useRealNavigation(f);const mark=f.click();await tick();Object.assign(f.state,{dirty:true,draft:'new text',draftVersion:1});
 void f.context.selectCustomer('b');await tick();assert.equal(f.state.id,'b');assert.equal(f.calls[1].route,'desk/customers/b?orders=defer');
 void f.context.selectCustomer('a');await tick();assert.equal(f.calls.length,2);
 f.waiters[0].resolve({revision:2,status:'done'});await mark;await tick();assert.equal(f.calls[2].input.patch.draft,'new text');assert.equal(f.calls[2].input.revision,2);
 f.waiters[2].resolve({revision:3,status:'done',draft:'new text'});await tick();assert.equal(f.calls[3].route,'desk/customers/a?orders=defer');
});
test('another customer draft and navigation do not queue behind the first customer status save',async()=>{
 const f=fixture();useRealDraftSave(f);useRealNavigation(f);const mark=f.click();await tick();Object.assign(f.state,{dirty:true,draft:'A draft',draftVersion:1});void f.context.selectCustomer('b');await tick();
 f.state.detail={customer:{id:'b'},work:{revision:4,status:'pending'}};Object.assign(f.state,{dirty:true,draft:'B draft',draftVersion:2});void f.context.selectCustomer('c');await tick();
 assert.equal(f.calls[2]?.route,'customers/b');assert.equal(f.calls[2].input.patch.draft,'B draft');f.waiters[2].resolve({revision:5,status:'pending',draft:'B draft'});await tick();assert.equal(f.state.id,'c');assert.equal(f.calls[3].route,'desk/customers/c?orders=defer');
 f.waiters[0].resolve({revision:2,status:'done'});await mark;await tick();f.waiters[4].resolve({revision:3,status:'done',draft:'A draft'});await tick();
});
test('an existing draft saves before marking; a new edit waits for the updated revision',async()=>{
 const f=fixture();useRealDraftSave(f);Object.assign(f.state,{dirty:true,draft:'first',draftVersion:1});const mark=f.click();await tick();assert.equal(f.calls[0].input.patch.draft,'first');
 f.waiters[0].resolve({revision:2,status:'pending',draft:'first'});await tick();assert.equal(f.calls[1].input.revision,2);assert.equal(f.calls[1].input.patch.status,'done');
 Object.assign(f.state,{dirty:true,draft:'second',draftVersion:2});const draft=f.context.saveDraft();await tick();assert.equal(f.calls.length,2);
 f.waiters[1].resolve({revision:3,status:'done',draft:'first'});await mark;await tick();assert.equal(f.calls[2].input.revision,3);assert.equal(f.calls[2].input.patch.draft,'second');f.waiters[2].resolve({revision:4,status:'done',draft:'second'});await draft;assert.equal(f.state.draft,'second');
});
test('mark request alone does not hold the draft queue used for navigation',async()=>{
 const f=fixture();useRealDraftSave(f);const mark=f.click();await tick();let ready=false;f.context.saveDraft().then(()=>ready=true);await tick();assert.equal(ready,true);f.waiters[0].resolve({revision:2,status:'done'});await mark;
});

test('marking handled never removes unread pending row or changes unread count',async()=>{const f=fixture();f.state.filter='pending';f.state.list.counts={pending:1};f.state.list.total=1;f.state.list.rows[0].unread=1;const p=f.click();await tick();f.waiters[0].resolve({revision:2,status:'done'});await p;assert.equal(f.state.list.rows.length,1);assert.equal(f.state.list.counts.pending,1);assert.equal(f.state.list.rows[0].status,'done');assert.equal(f.lists,0);});

test('mark done refreshes counts quietly after navigating to a page without that customer',async()=>{const f=fixture();const p=f.click();await tick();f.state.list={rows:[{id:'b',status:'pending'}],counts:{pending:41}};f.waiters[0].resolve({revision:2,status:'done'});await p;assert.equal(f.lists,1);assert.equal(f.state.list.rows[0].id,'b');});
