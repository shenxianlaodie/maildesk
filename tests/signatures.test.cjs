const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Store}=require('../backend/database.cjs'),{readSignatures,saveSignature,signatureFor}=require('../backend/signatures.cjs'),{createHash}=require('node:crypto');
test('signature settings default unbound, validate and persist bindings, isolate logged-in identities',()=>{
 const store=new Store(':memory:');try{
 const db=store.db,identity={corpId:'corp',unionId:'one'},id='dingtalk-'+createHash('sha256').update(JSON.stringify(['corp','one'])).digest('hex');store.addStaff({id,name:'One'});
 assert.deepEqual(readSignatures(db).map(r=>r.code),['Daisy','Jack','Debbie']);assert.ok(readSignatures(db).every(r=>r.staffId===null));
 saveSignature(db,{action:'add',code:'NEW'});assert.equal(readSignatures(db).length,4);
 assert.throws(()=>saveSignature(db,{action:'add',code:'daisy'}),/EXISTS/);assert.throws(()=>saveSignature(db,{action:'add',code:'bad\ncode'}),/INVALID/);
 assert.throws(()=>saveSignature(db,{action:'bind',code:'Daisy',staffId:'missing'}),/INVALID/);
 saveSignature(db,{action:'bind',code:'Daisy',staffId:id});
 assert.equal(signatureFor(readSignatures(db),identity).text,'Best regards,\nDaisy\nCustomer Support Team');
 assert.equal(signatureFor(readSignatures(db),{corpId:'corp',unionId:'two'}),null);assert.equal(signatureFor(readSignatures(db),null),null);
 assert.throws(()=>saveSignature(db,{action:'bind',code:'Jack',staffId:id}),/BOUND/);
 saveSignature(db,{action:'bind',code:'Daisy',staffId:''});assert.equal(signatureFor(readSignatures(db),identity),null);
 }finally{store.close();}
});
test('composer toggles without deleting body, follows edits and restores saved signature',async()=>{
 const text=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8'),snippet=text.slice(text.indexOf('const replySignatures='),text.lastIndexOf('init();'));
 const state={id:'a',draft:'Hello',meta:{signature:{text:'Best regards,\nDADA\nCustomer Support Team'}}},button={setAttribute(){}};
 let context;const area={value:state.draft,focus(){},setSelectionRange(){},dispatchEvent(){vm.runInContext('{const r=signatureRangeAfterEdit(state.draft,area.value,replySignatures.get(state.id));if(r)replySignatures.set(state.id,r);else replySignatures.delete(state.id);state.draft=area.value;}',context);}};
 const notices=[];context=vm.createContext({state,area,$:s=>s==='#reply'?area:button,refreshMeta:async()=>{},toast:s=>notices.push(s),Event:class{}});vm.runInContext(snippet,context);
 await vm.runInContext('toggleSignature()',context);assert.equal(area.value,'Hello\n\n'+state.meta.signature.text);
 area.value='Edited '+area.value;area.dispatchEvent();await vm.runInContext('toggleSignature()',context);assert.equal(area.value,'Edited Hello');
 await vm.runInContext('toggleSignature()',context);area.value+='\nPS';area.dispatchEvent();await vm.runInContext('toggleSignature()',context);assert.equal(area.value,'Edited Hello\nPS');
 area.value='Draft\n\n'+state.meta.signature.text;state.draft=area.value;vm.runInContext('restoreSignature()',context);await vm.runInContext('toggleSignature()',context);assert.equal(area.value,'Draft');
 state.meta.signature=null;await vm.runInContext('toggleSignature()',context);assert.equal(area.value,'Draft');assert.equal(notices.length,1);
 state.meta.signature={text:'Best regards,\nDADA\nCustomer Support Team'};await vm.runInContext('toggleSignature()',context);area.value=area.value.replace('DADA','Edited Name');area.dispatchEvent();assert.equal(vm.runInContext('replySignatures.has(state.id)',context),false);assert.match(area.value,/Edited Name/);
});
test('signature setting write remains administrator-only',()=>{
 const {permitted,permittedAdmin}=require('../backend/lan/proxy.cjs');
 assert.equal(permittedAdmin('POST','/api/settings/signatures'),true);
 assert.equal(permitted('POST','/api/settings/signatures'),false);
});
