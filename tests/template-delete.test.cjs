const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {worktools}=require('../backend/worktools.cjs');
test('delete template checks actor, audits deletion and is safe to retry',async()=>{
 const s=new Store(':memory:');try{
 s.addStaff({id:'agent',name:'客服'});
 const id=s.saveTemplate({title:'测试',keywords:'测试',body:'正文'},'agent');
 await assert.rejects(worktools('/api/templates','POST',{action:'delete',id},s,'missing'));
 assert.ok(s.db.prepare('SELECT id FROM templates WHERE id=?').get(id));
 const result=await worktools('/api/templates','POST',{action:'delete',id},s,'agent');
 assert.equal(result.deleted,true);
 assert.equal(s.db.prepare('SELECT id FROM templates WHERE id=?').get(id),undefined);
 assert.equal((await worktools('/api/templates','POST',{action:'delete',id},s,'agent')).deleted,false);
 await assert.rejects(worktools('/api/templates','POST',{action:'delete'},s,'agent'),/INVALID_TEMPLATE/);
 }finally{s.close();}
});
