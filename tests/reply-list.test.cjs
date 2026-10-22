'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
test('reply updates only the existing row label and preserves list order, counts and totals',()=>{
 const tag={};const rows=[{id:'first',status:'pending',unreplied:1},{id:'second',status:'pending',unreplied:1}];const list={rows,counts:{all:2,unreplied:2,pending:2},total:2};const context=vm.createContext({state:{list},$$:()=>[{dataset:{customer:'second'},querySelector:()=>tag}]});vm.runInContext(src.slice(src.indexOf('function updateRepliedRow('),src.indexOf('async function sendReply(')),context);context.updateRepliedRow('second','done');assert.equal(tag.textContent,'已处理');assert.equal(rows[1].unreplied,0);assert.deepEqual(rows.map(r=>r.id),['first','second']);assert.deepEqual(list.counts,{all:2,unreplied:2,pending:2});assert.equal(list.total,2);
});
