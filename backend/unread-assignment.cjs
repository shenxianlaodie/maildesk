'use strict';
const {randomUUID}=require('node:crypto');
const setting='unread_auto_assignment';
function validate(config){
 if(!config||config.enabled!==true)return null;
 if(!Array.isArray(config.staffIds)||!config.staffIds.length||config.staffIds.length>50||config.staffIds.some(id=>typeof id!=='string'||!id)||new Set(config.staffIds).size!==config.staffIds.length||!Number.isInteger(config.target)||config.target<1||config.target>1000)throw Error('INVALID_UNREAD_ASSIGNMENT_CONFIG');
 return config;
}
function planUnreadAssignments(db,input){
 const config=validate(input);if(!config)return{enabled:false,assignments:[],members:[]};
 require('./mailbox-permissions.cjs').install(db);
 const members=config.staffIds.map(id=>{
  const staff=db.prepare('SELECT id FROM staff WHERE id=? AND active=1').get(id);if(!staff)return null;
  const access=db.prepare('SELECT inbox_ids FROM staff_mailbox_access WHERE staff_id=?').get(id);
  return{id,allowed:access?new Set(JSON.parse(access.inbox_ids)):null,before:0,after:0,added:0};
 }).filter(Boolean);
 const rows=db.prepare(`SELECT w.customer_id,w.assignee_id,w.revision,min(m.sent_at) oldest,json_group_array(DISTINCT m.inbox_id) inboxes
 FROM customer_work w JOIN messages m ON m.customer_id=w.customer_id
 WHERE m.direction='inbound' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message_id=m.id)
 GROUP BY w.customer_id ORDER BY oldest ASC,w.customer_id`).all().map(r=>({...r,inboxes:JSON.parse(r.inboxes)}));
 const permits=(member,row)=>!member.allowed||row.inboxes.some(id=>member.allowed.has(id));
 for(const row of rows){const member=members.find(m=>m.id===row.assignee_id);if(member&&permits(member,row))member.before++;}
 for(const member of members)member.after=member.before;
 const sending=db.prepare("SELECT 1 FROM outgoing WHERE customer_id=? AND status IN ('sending','unknown') LIMIT 1");
 const assignments=[];
 for(const row of rows){
  if(row.assignee_id!==null||sending.get(row.customer_id))continue;
  const eligible=members.filter(m=>m.after<config.target&&permits(m,row)).sort((a,b)=>a.after-b.after||(a.allowed?.size??Infinity)-(b.allowed?.size??Infinity));
  const member=eligible[0];if(!member)continue;
  assignments.push({customerId:row.customer_id,staffId:member.id,revision:row.revision,oldest:row.oldest});member.after++;member.added++;
 }
 return{enabled:true,target:config.target,assignments,members:members.map(({id,before,after,added})=>({id,before,after,added}))};
}
function refillUnreadAssignments(store,{clock=Date.now}={}){
 const raw=store.db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting);
 if(!raw||!validate(JSON.parse(raw.value)))return{enabled:false,assigned:0,members:[]};
 return store.transaction(()=>{
  const current=store.db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting);
  const plan=planUnreadAssignments(store.db,current?JSON.parse(current.value):null);
  if(!plan.enabled)return{enabled:false,assigned:0,members:[]};
  const at=new Date(clock()).toISOString(),runId=randomUUID();
  const assign=store.db.prepare('UPDATE customer_work SET assignee_id=?,revision=revision+1,updated_at=? WHERE customer_id=? AND assignee_id IS NULL AND revision=?');
  for(const item of plan.assignments){
   const result=assign.run(item.staffId,at,item.customerId,item.revision);if(result.changes!==1)throw Error('UNREAD_ASSIGNMENT_CONFLICT');
   store.audit('local-operator','customer.unread_auto_assignment',item.customerId,{runId,assigneeId:item.staffId,previousAssigneeId:null,previousRevision:item.revision,oldestUnread:item.oldest,target:plan.target});
  }
  const result={enabled:true,at,runId,target:plan.target,assigned:plan.assignments.length,members:plan.members};
  store.db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(setting+'_last_run',JSON.stringify(result));return result;
 });
}
function createUnreadAssignmentWorker(store,{intervalMs=30000,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>console.error('UNREAD_AUTO_ASSIGNMENT_FAILED')}={}){
 let started=false,closed=false,timer=null,pending=Promise.resolve();
 function schedule(delay){if(closed||!started||timer!==null)return;timer=setTimer(()=>{timer=null;pending=Promise.resolve().then(()=>{if(!closed)refillUnreadAssignments(store);}).catch(onError).finally(()=>schedule(intervalMs));return pending;},delay);timer?.unref?.();}
 return{start(){if(started||closed)return;started=true;schedule(0);},async close(){closed=true;if(timer!==null){clearTimer(timer);timer=null;}await pending;}};
}
module.exports={planUnreadAssignments,refillUnreadAssignments,createUnreadAssignmentWorker};
