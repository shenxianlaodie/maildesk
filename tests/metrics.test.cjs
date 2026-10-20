const test=require('node:test'),assert=require('node:assert/strict');
const {refundByPercent,analyze}=require('../dist/metrics.js');
test('percentage refund rounds to cents and supports explicit bases',()=>{
 assert.equal(refundByPercent('59.90','10','20').requested,1198);
 assert.equal(refundByPercent('59.90','10','20','remaining').requested,998);
 assert.equal(refundByPercent('0.05','0','50').requested,3);
 assert.equal(refundByPercent('59.90','10','100','remaining').remaining,0);
 for(const p of ['-1','101','1.111','NaN',''])assert.throws(()=>refundByPercent('10','0',p));
 assert.throws(()=>refundByPercent('59.90','10','100'));
});
test('analytics deduplicates arrivals, uses replying agent and preserves unreplied count',()=>{
 const m={id:1,email:'a@example.com',messageId:'m1',shop:'A',at:'2026-09-02T11:00:00',orderIds:['o1']};
 const result=analyze({from:'2026-09-01',to:'2026-09-03',orders:[{id:'o1',shop:'A',date:'2026-09-01',placedAt:'2026-09-01T11:00:00',amount:100,refunded:20,currency:'USD',dissatisfaction:'质量'}],messages:[m,{...m,id:2},{...m,id:3,messageId:'m2',at:'2026-09-03T11:00:00'}],replies:[{customer:m.email,inReplyTo:'m1',at:'2026-09-02T11:30:00',agent:'客服甲'}]});
 assert.equal(result.incoming,2);assert.equal(result.unreplied,1);assert.equal(result.average,30);assert.equal(result.agents[0].agent,'客服甲');
 assert.equal(result.stores[0].rate,1);assert.equal(result.stores[0].amounts[0].rate,.2);assert.equal(result.delays[0].hours,24);assert.equal(result.buckets[1].count,1);
});
test('empty and invalid analytics ranges do not create false zero reply times',()=>{
 const input={orders:[],messages:[],replies:[],from:'2026-09-01',to:'2026-09-02'};assert.equal(analyze(input).average,null);assert.throws(()=>analyze({...input,from:'2026-10-01'}));
});
