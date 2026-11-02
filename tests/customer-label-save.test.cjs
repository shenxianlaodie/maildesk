const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(label=''){
 const state={detail:{customer:{id:'a'},labels:[]},meta:{labels:[{id:'vip',name:'VIP'}]},list:{rows:[{id:'a',labels:[]},{id:'b',labels:[]}]},filters:{label}},nodes={},messages=[];
 let resolve,reject,refreshes=0;
 const request=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const dialog={open:true,close(){this.open=false;}};
 const context=vm.createContext({state,FormData:class{getAll(){return ['vip'];}},$:s=>s==='#dialog'?dialog:nodes[s],modal:()=>{nodes['#edit-form']={querySelector:()=>({disabled:false})};nodes['#cancel-form']={};nodes['#form-error']={};nodes['#create-customer-label']={};},esc:v=>v,icon:()=>'',labelStyle:()=>'',api:()=>request,toast:m=>messages.push(m),errorText:e=>e.message,renderCustomerLabels:()=>{},renderList:()=>{},loadList:()=>{refreshes++;return new Promise(()=>{});}});
 vm.runInContext(source.slice(source.indexOf('function formModal('),source.indexOf('\n',source.indexOf('function formModal('))),context);
 vm.runInContext(source.slice(source.indexOf('function customerTags('),source.indexOf('function labelStyle(')),context);
 context.customerTags();
 return {state,context,dialog,nodes,messages,resolve,reject,get refreshes(){return refreshes;},submit:()=>{const form=nodes['#edit-form'];return form.onsubmit({preventDefault(){},target:form});}};
}
test('successful label save closes without querying all conversations and updates the matching row',async()=>{
 const f=fixture(),pending=f.submit();f.resolve({saved:true});await tick();
 assert.equal(f.dialog.open,false);assert.equal(f.refreshes,0);assert.equal(f.state.list.rows[0].labels[0].id,'vip');assert.deepEqual(f.state.list.rows[1].labels,[]);await pending;
});
test('label-filter refresh cannot hold the save dialog open',async()=>{
 const f=fixture('vip'),pending=f.submit();f.resolve({saved:true});await tick();assert.equal(f.refreshes,1);assert.equal(f.dialog.open,false);await pending;
});
test('failed label save keeps selections available and does not change saved labels',async()=>{
 const f=fixture(),pending=f.submit();f.reject(Error('offline'));await pending;assert.equal(f.dialog.open,true);assert.equal(f.nodes['#form-error'].textContent,'offline');assert.deepEqual(f.state.detail.labels,[]);assert.equal(f.refreshes,0);
});
test('completion of an old save does not close a new dialog or change another customer',async()=>{
 const f=fixture(),pending=f.submit();f.state.detail={customer:{id:'b'},labels:[]};f.context.customerTags();f.resolve({saved:true});await tick();assert.equal(f.dialog.open,true);assert.deepEqual(f.state.detail.labels,[]);
});
