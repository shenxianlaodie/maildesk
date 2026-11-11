'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {operation,details,shouldRecord,actionTitle,createOperationLog,addressOutcome}=require('../backend/operation-log.cjs');
test('address actions have distinct titles and only submissions are recorded',()=>{
 const action=operation('POST','/api/desk/order');
 for(const name of ['read-address','address-status'])assert.equal(shouldRecord(action,details({action:name},'/api/desk/order')),false);
 const info=details({action:'update-address',orderId:'pg:12',requestId:'42',address:{street:'PRIVATE'}},'/api/desk/order');
 assert.equal(shouldRecord(action,info),true);assert.equal(actionTitle(action,info),'提交地址修改');assert.doesNotMatch(JSON.stringify(info),/PRIVATE/);
});
test('old address submissions are searchable in Chinese without rewriting history',()=>{
 const log=createOperationLog(':memory:');try{for(const action of ['update-address','read-address','address-status'])log.append({at:new Date().toISOString(),actor:{account:'客服',accountId:'1',role:'staff',auth:'password'},action:'修改订单备注',route:'/api/desk/order',result:'success',status:200,details:{action,orderId:'pg:12'}});
 const matches=log.list(new URLSearchParams({q:'修改地址'})).rows;assert.equal(matches.length,2);const rows=matches.filter(r=>r.action==='提交地址修改');assert.equal(rows.length,1);assert.equal(rows[0].action,'提交地址修改');assert.equal(rows[0].result,'unknown');assert.equal(log.list(new URLSearchParams({q:'读取订单地址'})).rows.length,1);
 }finally{log.close();}
});
test('address queue states distinguish accepted, succeeded, failed and uncertain',()=>{
 for(const status of ['pending','processing'])assert.equal(addressOutcome({status}),'accepted');
 assert.equal(addressOutcome({status:'succeeded'}),'success');assert.equal(addressOutcome({status:'failed'}),'failed');assert.equal(addressOutcome({status:'uncertain'}),'unknown');assert.equal(addressOutcome({}),'unknown');
});
