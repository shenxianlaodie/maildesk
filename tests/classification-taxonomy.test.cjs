const test=require('node:test'),assert=require('node:assert/strict');
const {taxonomy,shippingEvidence,classifyAI}=require('../backend/ai.cjs');
test('seven categories and logistics status require evidence',()=>{
 assert.equal(Object.keys(taxonomy).length,7);
 assert.deepEqual(taxonomy['物流异常'],['物流异常']);
 assert.equal(shippingEvidence([{shipping:'waiting',shipments:[]}]),'未发货');
 assert.equal(shippingEvidence([{shipping:'shipped',shipments:[{tracking_number:'123'}]}]),null);
 assert.equal(shippingEvidence([{tracking:[{at:'2026-10-20',status:'Delivered'}]}]),'已签收');
 assert.equal(shippingEvidence([{tracking:[{at:'2026-10-20',status:'In transit'}]}]),'未签收');
 assert.equal(shippingEvidence([{tracking:[{status:'Not delivered'}]}]),null);
 assert.equal(shippingEvidence([{shipping:'waiting'},{shipping:'shipped'}]),null);
});
test('AI cannot fabricate delivery classification from mail text',async()=>{
 const mock=async()=>new Response(JSON.stringify({output_text:JSON.stringify({category:'物流异常',subcategory:'已签收',reason:'email says delivered',confidence:1})}));
 const result=await classifyAI({apiKey:'fake',model:'test'},{subject:'Delivered',body_text:'delivered'},[{shipping:'shipped',shipments:[{tracking_number:'123'}]}],mock);
 assert.equal(result.category,'物流异常');assert.equal(result.subcategory,'物流异常');
});
test('migration preserves original categories and new imports use fallback',()=>{const {Store}=require('../backend/database.cjs');const {migrateClassification}=require('../backend/classification-taxonomy.cjs');const s=new Store(':memory:');try{s.addInbox({id:'i',address:'a@example.com'});const {id}=s.upsertMessage({inboxId:'i',providerId:'1',direction:'inbound',customerEmail:'b@example.com',fromAddress:'b@example.com',sentAt:new Date().toISOString()});assert.equal(s.db.prepare('SELECT category FROM messages WHERE id=?').get(id).category,'未能正确分类');s.db.prepare('UPDATE messages SET category=?,subcategory=? WHERE id=?').run('售后','物流查询',id);migrateClassification(s);migrateClassification(s);assert.equal(s.db.prepare('SELECT category FROM messages WHERE id=?').get(id).category,'未能正确分类');assert.equal(s.db.prepare('SELECT subcategory FROM classification_previous WHERE message_id=?').get(id).subcategory,'物流查询');}finally{s.close();}});

test('migration merges old logistics subcategories without changing other categories',()=>{
 const {Store}=require('../backend/database.cjs'),{migrateClassification}=require('../backend/classification-taxonomy.cjs');const s=new Store(':memory:');try{
 s.addInbox({id:'i',address:'a@example.com'});
 for(const [i,sub] of ['未发货','已签收','未签收','状态待核实'].entries()){
 const {id}=s.upsertMessage({inboxId:'i',providerId:String(i),direction:'inbound',customerEmail:'b@example.com',fromAddress:'b@example.com',sentAt:new Date().toISOString()});
 s.db.prepare("UPDATE messages SET category='物流异常',subcategory=? WHERE id=?").run(sub,id);
 }
 migrateClassification(s);migrateClassification(s);
 assert.equal(s.db.prepare("SELECT count(*) n FROM messages WHERE category='物流异常' AND subcategory='物流异常'").get().n,4);
 assert.equal(s.db.prepare('SELECT count(*) n FROM classification_previous').get().n,4);
 }finally{s.close();}
});
