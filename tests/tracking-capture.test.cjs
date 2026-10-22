const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {capture,attach,validate}=require('../backend/tracking-capture.cjs');
const {shippingEvidence}=require('../backend/ai.cjs');
const order={id:'pg:1',shipments:[{tracking_number:'VR123456789YP'}]},input={number:'VR123456789YP',sourceUrl:'https://extcall.17track.net/en/track',text:'VR123456789YP\nDelivered\nPackage delivered to recipient.'};
const mock=result=>async()=>new Response(JSON.stringify({output_text:JSON.stringify(result)}));
test('capture binds to order and trusted source; preserves evidence without fabricating tracking events',async()=>{const s=new Store(':memory:');try{await capture(s,order,input,{apiKey:'test',model:'test'},mock({status:'delivered',evidence:'Delivered'}));const o=attach(s.db,{...order});assert.equal(o.trackingCaptures.length,1);assert.equal(shippingEvidence([o]),'已签收');assert.equal(o.tracking,undefined);assert.throws(()=>validate(order,{...input,number:'WRONG123'}),/MISMATCH/);assert.throws(()=>validate(order,{...input,sourceUrl:'https://evil.example/'}),/SOURCE/);await assert.rejects(capture(s,order,input,{apiKey:'test',model:'test'},mock({status:'delivered',evidence:'invented'})),/EVIDENCE/);await capture(s,order,input,{apiKey:'test',model:'test'},mock({status:'unknown',evidence:''}));assert.equal(shippingEvidence([attach(s.db,{...order})]),null);}finally{s.close();}});
test('expired captures and mixed unknown packages do not establish signature',()=>{const o={...order,trackingCaptures:[{number:input.number,status:'delivered',captured_at:'2000-01-01'}]};assert.equal(shippingEvidence([o]),null);o.trackingCaptures[0].captured_at=new Date().toISOString();o.shipments=[...order.shipments,{tracking_number:'OTHER123'}];assert.equal(shippingEvidence([o]),null);});
test('Chrome automatic bridge rejects foreign messages and validates requests',async()=>{const fs=require('fs'),vm=require('vm');let handler,sent=0;const window={addEventListener:(name,fn)=>handler=fn,postMessage:()=>{}};vm.runInNewContext(fs.readFileSync('chrome-extension/bridge.js','utf8'),{window,location:{origin:'https://chat.thinkpro.top'},chrome:{runtime:{sendMessage:async()=>{sent++;return{};}}}});const data={type:'maildesk-tracking-request',requestId:'a'.repeat(36),number:input.number};await handler({source:{},origin:'https://chat.thinkpro.top',data});assert.equal(sent,0);await handler({source:window,origin:'https://evil.example',data});assert.equal(sent,0);await handler({source:window,origin:'https://chat.thinkpro.top',data});assert.equal(sent,1);const manifest=JSON.parse(fs.readFileSync('chrome-extension/manifest.json'));assert.deepEqual(manifest.host_permissions,['https://chat.thinkpro.top/*','https://extcall.17track.net/*']);let listener;vm.runInNewContext(fs.readFileSync('chrome-extension/background.js','utf8'),{URL,chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}}});assert.equal(listener({type:'read-tracking'},{frameId:0,tab:{id:1},url:'https://evil.example'},()=>assert.fail()),undefined);});

test('capture updates logistics classification while preserving manual choices and ambiguous orders',async()=>{
 const {updateClassifications}=require('../backend/tracking-capture.cjs'),s=new Store(':memory:');try{
 require('../backend/desk.cjs').installDesk(s.db);s.addInbox({id:'i',address:'a@example.com'});
 const ids=[1,2,3].map(n=>s.upsertMessage({inboxId:'i',providerId:String(n),direction:'inbound',customerEmail:'b@example.com',fromAddress:'b@example.com',sentAt:new Date().toISOString()}).id);
 const customerId=s.db.prepare('SELECT customer_id FROM messages WHERE id=?').get(ids[0]).customer_id;
 for(const id of ids.slice(0,2))s.db.prepare("UPDATE messages SET category='物流异常',subcategory='状态待核实' WHERE id=?").run(id);
 s.db.prepare("INSERT INTO ai_jobs(message_id,status,reason) VALUES(?,'done','人工分类')").run(ids[1]);
 await capture(s,order,input,{apiKey:'test',model:'test'},mock({status:'delivered',evidence:'Delivered'}));
 assert.equal(updateClassifications(s,customerId,[{...order},{id:'other',shipments:[]}]),0);
 assert.equal(updateClassifications(s,customerId,[{...order}]),1);
 assert.equal(s.db.prepare('SELECT subcategory FROM messages WHERE id=?').get(ids[0]).subcategory,'物流异常');
 assert.equal(s.db.prepare('SELECT subcategory FROM messages WHERE id=?').get(ids[1]).subcategory,'状态待核实');
 assert.equal(s.db.prepare('SELECT status FROM ai_jobs WHERE message_id=?').get(ids[2]).status,'pending');
 }finally{s.close();}
});

test('Copy Details survive AI failure and are returned unchanged; mismatched details rejected',async()=>{
 const s=new Store(':memory:');try{const detailed={...input,copyDetails:input.text};
 const result=await capture(s,order,detailed,{},async()=>{throw Error('offline');});assert.equal(result.copy_details,input.text);assert.equal(result.status,'unknown');assert.ok(result.recognitionError);
 assert.equal(attach(s.db,{...order}).trackingCaptures[0].copy_details,input.text);
 assert.throws(()=>validate(order,{...detailed,copyDetails:'different'}),/DETAILS_INVALID/);
 }finally{s.close();}
});

test('extension extracts Copy Details attributes, deduplicates responsive buttons, and rejects other waybills',async()=>{
 const fs=require('fs'),vm=require('vm');let listener;let values=[input.text,input.text,'Number: OTHER123\nDelivered'];
 const context={URL,location:{origin:'https://extcall.17track.net',href:input.sourceUrl},document:{querySelectorAll:selector=>{assert.equal(selector,'[data-copy-details][data-clipboard-text]');return values.map(value=>({getAttribute:()=>value}));}},chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}},webNavigation:{getAllFrames:async()=>[{frameId:2,url:input.sourceUrl}]},scripting:{executeScript:async opts=>[{result:opts.func(...opts.args)}]}}};
 vm.runInNewContext(fs.readFileSync('chrome-extension/background.js','utf8'),context);
 const run=()=>new Promise(resolve=>listener({type:'read-tracking',number:input.number,requestId:'a'.repeat(36)},{frameId:0,tab:{id:Math.random()},url:'https://chat.thinkpro.top/maildesk/'},resolve));
 const result=await run();assert.equal(result.capture.copyDetails,input.text);assert.equal(result.capture.text,input.text);
 values=['Number: OTHER123\nDelivered'];assert.ok((await run()).error);
});
