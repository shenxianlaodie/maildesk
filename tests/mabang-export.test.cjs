'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const exp=require('../backend/public/desk/mabang-export.js');
const row=(number='LQ001')=>({order_number:number,order_id:'internal',request_id:'1',pending:true,after:{first_name:'A',last_name:'B',phone:'00123',country_code:'US',province:'New York',city:'Albany',zip:'00102',address:'10 A & B <Road>',address1:'Apt 2',company:'Shop'}});
function unzip(bytes){const b=Buffer.from(bytes),files={};let p=0;while(b.readUInt32LE(p)===0x04034b50){assert.equal(b.readUInt16LE(p+8),0);const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),e=b.readUInt16LE(p+28),name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+e;files[name]=b.subarray(start,start+size).toString();p=start+size;}assert.equal(b.readUInt32LE(p),0x02014b50);return files;}
test('address export maps platform order number and preserves text identifiers',()=>{const values=exp.values(row());assert.equal(values.length,26);assert.equal(values[0],'LQ001');assert.equal(values[1],'A B');assert.equal(values[2],'00123');assert.equal(values[7],'00102');assert.equal(values[8],'10 A & B <Road>');assert.equal(values[10],'Apt 2');assert.equal(values[14],'New York');assert.equal(values[15],'Albany');assert.equal(values[18],'Shop');assert.equal(values[4],'');assert.equal(values[5],'');});
test('copy selected order numbers uses one number per line',()=>{assert.equal(exp.orderNumbers([row('LQ01'),row('LQ02')]),'LQ01\nLQ02');});
test('xlsx preserves template sheets and headers, writes escaped inline text not formulas',()=>{const files=unzip(exp.build([row('=00123')]));assert.match(files['xl/workbook.xml'],/省份参考列表/);assert.match(files['xl/sharedStrings.xml'],/\*编号/);assert.match(files['xl/worksheets/sheet2.xml'],/<sheetData>/);const sheet=files['xl/worksheets/sheet1.xml'];assert.match(sheet,/<row r="1"/);assert.match(sheet,/A1:Z2/);assert.match(sheet,/r="A2" t="inlineStr"/);assert.match(sheet,/=00123/);assert.match(sheet,/00102/);assert.match(sheet,/A &amp; B &lt;Road&gt;/);assert.doesNotMatch(sheet,/<f>/);});
test('export rejects missing platform number and duplicate matching numbers',()=>{assert.throws(()=>exp.build([]),/请选择/);assert.throws(()=>exp.build([row('')]),/平台订单号/);assert.throws(()=>exp.build([row(),row()]),/重复/);assert.throws(()=>exp.build([{...row(),after:null}]),/地址/);});
test('selection follows filters and drops replaced address requests',()=>{
 const vm=require('node:vm'),fs=require('node:fs');const ctx=vm.createContext({setInterval:()=>0,window:{},document:{},Set});
 vm.runInContext(fs.readFileSync(require.resolve('../backend/public/desk/mabang-address.js'),'utf8'),ctx);
 vm.runInContext(`mabangData={rows:[{request_id:'1',order_number:'LQ1',store_domain:'a',pending:true},{request_id:'2',order_number:'LQ2',store_domain:'a',pending:true},{request_id:'3',order_number:'LQ3',store_domain:'a',pending:false}]};mabangSelectAll(true);`,ctx);
 assert.equal(vm.runInContext('mabangSelectedRows().length',ctx),2);
 vm.runInContext(`mabangQuery='LQ2';mabangPruneSelection();`,ctx);assert.equal(vm.runInContext('mabangSelectedRows()[0].request_id',ctx),'2');
 vm.runInContext(`mabangData.rows=mabangData.rows.filter(r=>r.request_id!=='2');mabangPruneSelection();`,ctx);assert.equal(vm.runInContext('mabangSelected.size',ctx),0);
});
test('download only reads fresh data and uses a browser blob without confirming orders',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),calls=[],urls=[],rows=[row()];let clicked=0,download;
 const button={},link={click(){clicked++;download=this.download;},remove(){}};
 const ctx=vm.createContext({setInterval:()=>0,setTimeout:f=>f(),window:{},document:{createElement:()=>link,body:{appendChild(){}}},Set,Blob,URL:{createObjectURL:b=>{assert.equal(b.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return 'blob:export';},revokeObjectURL:u=>urls.push(u)},MabangExport:exp,$:()=>button,toast:()=>{},api:async(...args)=>{calls.push(args);return{rows,error:null};},rows});
 vm.runInContext(fs.readFileSync(require.resolve('../backend/public/desk/mabang-address.js'),'utf8'),ctx);
 vm.runInContext('mabangData={rows};mabangSelectAll(true);renderMabangAddresses=()=>{};',ctx);
 await vm.runInContext('exportMabangAddresses()',ctx);assert.equal(clicked,1);assert.match(download,/1单\.xlsx$/);assert.equal(calls.length,1);assert.equal(calls[0].length,1);assert.match(calls[0][0],/refresh=1/);assert.deepEqual(urls,['blob:export']);assert.equal(rows[0].pending,true);
});
test('render binds selection, copy and export controls for populated and empty lists',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),nodes={},checkbox={dataset:{mabangSelect:'1'},checked:false};
 const ctx=vm.createContext({setInterval:()=>0,window:{},Set,$:s=>nodes[s]||(nodes[s]={}),$$:s=>s==='[data-mabang-select]'?[checkbox]:[],modal:()=>{},esc:String,fullTime:String,run:f=>f,MabangExport:exp,copy:()=>{},rows:[{...row(),before:{},store_domain:'shop',actor:'',source:'staff',completed_at:'2026-11-12'}]});
 vm.runInContext(fs.readFileSync(require.resolve('../backend/public/desk/mabang-address.js'),'utf8'),ctx);
 vm.runInContext('mabangData={rows,pending:1};renderMabangAddresses();',ctx);
 assert.equal(typeof checkbox.onchange,'function');checkbox.checked=true;checkbox.onchange();assert.equal(nodes['#mabang-export'].disabled,false);assert.equal(nodes['#mabang-select-all'].checked,true);
 nodes['#mabang-select-all'].onchange({target:{checked:false}});assert.equal(nodes['#mabang-export'].disabled,true);
 vm.runInContext('mabangData.rows=[];renderMabangAddresses();',ctx);assert.equal(nodes['#mabang-select-all'].disabled,true);
});
test('batch UI confirms only pending selection and preserves it on failure or cancel',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),calls=[],notes=[];let accept=false,fail=false;
 const rows=[{...row(),request_id:'1'}, {...row('LQ2'),request_id:'2',pending:false}];
 const ctx=vm.createContext({setInterval:()=>0,window:{},Set,rows,confirm:()=>accept,toast:m=>notes.push(m),api:async(p,b)=>{calls.push(b);if(fail)throw Error('MABANG_ADDRESS_CHANGED');}});
 vm.runInContext(fs.readFileSync(require.resolve('../backend/public/desk/mabang-address.js'),'utf8'),ctx);
 vm.runInContext("mabangData={rows};mabangStatus='all';mabangSelectAll(true);mabangSelectionControls=()=>{};renderMabangAddresses=()=>{};mabangRefresh=async()=>{}",ctx);
 await vm.runInContext('confirmSelectedMabangAddresses()',ctx);assert.equal(calls.length,0);
 accept=true;fail=true;await vm.runInContext('confirmSelectedMabangAddresses()',ctx);assert.equal(rows[0].pending,true);assert.equal(vm.runInContext('mabangSelected.size',ctx),2);
 fail=false;await vm.runInContext('confirmSelectedMabangAddresses()',ctx);assert.deepEqual(Array.from(calls[1].requestIds),['1']);assert.equal(rows[0].pending,false);assert.equal(vm.runInContext('mabangSelected.has("1")',ctx),false);
});

test('select all cannot select an address received by background refresh but not displayed',()=>{
 const vm=require('node:vm'),fs=require('node:fs');const ctx=vm.createContext({setInterval:()=>0,window:{},document:{},Set});
 vm.runInContext(fs.readFileSync(require.resolve('../backend/public/desk/mabang-address.js'),'utf8'),ctx);
 vm.runInContext("mabangRenderedIds=new Set(['1']);mabangData={rows:[{request_id:'2',order_number:'LQ1',store_domain:'a',pending:true}]};mabangSelectAll(true);",ctx);
 assert.equal(vm.runInContext('mabangSelected.size',ctx),0);
});
