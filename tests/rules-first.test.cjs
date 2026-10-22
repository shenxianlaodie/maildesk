'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyRules,classifyMessage,currentText}=require('../backend/classify.cjs');
const m=(body,subject='')=>({subject,body_text:body});
test('rules map explicit requests to new categories',()=>{
 for(const [body,category] of [['Please cancel my order','修改订单信息'],['Please change my shipping address','修改订单信息'],['Please change the size to XL','修改订单信息'],['Please ship my order today','催发货'],['When will my order ship?','催发货'],['What size should I choose?','售前咨询'],['What material is this made of?','售前咨询'],['I received a damaged shirt and want a refund','收到货不满意'],['收到的衣服太小了','收到货不满意']])assert.equal(classifyRules(m(body))?.category,category,body);
 assert.equal(classifyRules(m('Delivery failed','Undeliverable: hello')).category,'各种通知以及垃圾邮件');
});
test('uncertain, conflicting and negated requests defer to AI',()=>{
 for(const body of ['Refund please','What is your return policy?','Please do not cancel my order','Where is my order? Please cancel my order','Hello','Thanks'])assert.equal(classifyRules(m(body)),null,body);
 assert.equal(classifyRules(m('Thanks','Re: cancel my order')),null);
 assert.equal(classifyRules(m('My shirt is not damaged')),null);
});
test('logistics uses actual order evidence and never guesses from a tracking number or customer claim',()=>{
 assert.equal(classifyRules(m('Where is my order?'),[{fulfillment_status:'waiting',shipments:[]}]).subcategory,'物流异常');
 assert.equal(classifyRules(m('I have not received my package'),[{tracking:[{status:'Delivered',at:'2026-10-20'}]}]).subcategory,'物流异常');
 assert.equal(classifyRules(m('Where is my package?'),[{tracking:[{status:'In transit',at:'2026-10-20'}]}]).subcategory,'物流异常');
 assert.equal(classifyRules(m('Tracking says delivered. Where is my package?'),[{shipments:[{tracking_number:'123'}]}]).subcategory,'物流异常');
 assert.equal(classifyRules(m('Where is my order?'),[{shipping:'waiting'},{shipping:'shipped'}]).subcategory,'物流异常');
});
test('quoted history and signatures cannot trigger classification',()=>{
 assert.equal(currentText('Thanks\nOn yesterday wrote:\nPlease cancel my order'),'Thanks');
 assert.equal(classifyRules(m('Thanks\n> Please cancel my order')),null);
 assert.equal(classifyRules(m('Hello\nBest regards,\nPlease cancel my order')),null);
});
test('rules run without AI config and bypass both order queries and AI requests when sufficient',async()=>{
 const fail=()=>{throw Error('must not call');};const r=await classifyMessage({},m('Please cancel my order'),fail,fail);assert.equal(r.mode,'rules');
 const s=await classifyMessage({},m('Where is my order?'),fail,fail);assert.equal(s.mode,'rules');
 assert.equal(await classifyMessage({},m('Hello'),async()=>[],fail),null);
});
test('ambiguous requests call AI only when enabled and strip old quoted text',async()=>{
 let calls=0;const mock=async(url,options)=>{calls++;assert.ok(!options.body.includes('QUOTED_SECRET'));return new Response(JSON.stringify({output_text:JSON.stringify({category:'售前咨询',subcategory:'售前咨询',confidence:0.9,reason:'Customer asks about stock'})}));};
 const result=await classifyMessage({apiKey:'fake',model:'test',autoClassify:true},m('Is this available?\n> QUOTED_SECRET'),async()=>[],mock);assert.equal(calls,1);assert.equal(result.mode,'ai');
});
test('assistant uses category and does not default unrelated emails to logistics',()=>{
 const {suggestion}=require('../backend/desk.cjs');const d={customer:{display_name:'Customer'},messages:[{direction:'inbound',subject:'Hello',body_text:'Thanks',category:'未能正确分类',subcategory:'未能正确分类'}],orders:[]};
 assert.equal(suggestion(d).issue,'未能正确分类');d.messages[0].category='催发货';d.messages[0].subcategory='催发货';assert.equal(suggestion(d).issue,'催发货');assert.match(suggestion(d).recommendation,/仓库/);
});
test('startup migration seeds unresolved jobs without changing a manual decision',()=>{
 const {Store}=require('../backend/database.cjs'),{createPilot}=require('../backend/pilot.cjs');const s=new Store(':memory:');s.addInbox({id:'i',address:'a@example.com'});const saved=s.upsertMessage({inboxId:'i',providerId:'p',direction:'inbound',customerEmail:'b@example.com',fromAddress:'b@example.com',sentAt:new Date().toISOString()});s.db.prepare("INSERT INTO ai_jobs(message_id,status,reason) VALUES(?,'done','人工分类')").run(saved.id);
 createPilot({store:s,vault:{get:()=>({}),status:()=>({})},autoSync:false,demo:true});assert.equal(s.db.prepare('SELECT status FROM ai_jobs WHERE message_id=?').get(saved.id).status,'done');s.close();
});
