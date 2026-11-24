'use strict';
const {randomUUID}=require('node:crypto');
const assignmentState=require('./assignment-state.cjs');
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
  const ids=access?JSON.parse(access.inbox_ids):null;
  const cte=ids?require('./mailbox-permissions.cjs').createScope({db},id,ids).cte:'';
  // Match the scoped 'awaiting my reply' tab, including read but unanswered mail.
  const pending=db.prepare(cte+`SELECT w.customer_id,w.assignee_id FROM customer_work w WHERE (w.assignee_id=? OR EXISTS(SELECT 1 FROM messages u WHERE u.customer_id=w.customer_id AND u.direction='inbound' AND NOT EXISTS(SELECT 1 FROM message_reads rr WHERE rr.message_id=u.id))) AND EXISTS(
   SELECT 1 FROM messages m WHERE m.customer_id=w.customer_id AND m.direction='inbound'
   AND NOT EXISTS(SELECT 1 FROM outgoing o WHERE o.parent_id=m.id AND o.status IN('accepted','demo'))
   AND NOT EXISTS(SELECT 1 FROM messages r WHERE r.customer_id=w.customer_id AND r.direction='outbound' AND r.sent_at>=m.sent_at))`).all(id);
  return{id,allowed:ids?new Set(ids):null,pending:new Set(pending.map(r=>r.customer_id)),before:pending.filter(r=>r.assignee_id===id).length,after:0,added:0};
 }).filter(Boolean);
 const rows=db.prepare(`SELECT w.customer_id,w.assignee_id,w.revision,min(m.sent_at) oldest,json_group_array(DISTINCT m.inbox_id) inboxes
 FROM customer_work w JOIN messages m ON m.customer_id=w.customer_id
 WHERE m.direction='inbound' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message_id=m.id)
 GROUP BY w.customer_id ORDER BY oldest ASC,w.customer_id`).all().map(r=>({...r,inboxes:JSON.parse(r.inboxes)}));
 const permits=(member,row)=>member.pending.has(row.customer_id)&&(!member.allowed||row.inboxes.some(id=>member.allowed.has(id)));
 for(const member of members)member.after=member.before;
 const sending=db.prepare("SELECT 1 FROM outgoing WHERE customer_id=? AND status IN ('sending','unknown') LIMIT 1");
 const assignments=[];
 for(const row of rows){
  if(row.assignee_id!==null||sending.get(row.customer_id))continue;
  const eligible=members.filter(m=>m.after<config.target&&permits(m,row)).sort((a,b)=>a.after-b.after||(a.allowed?.size??Infinity)-(b.allowed?.size??Infinity));
  const member=eligible[0];if(!member)continue;
  assignments.push({customerId:row.customer_id,staffId:member.id,previousAssigneeId:null,revision:row.revision,oldest:row.oldest});member.after++;member.added++;
 }
 if(config.transferExcess===true){
  for(const row of [...rows].sort((a,b)=>String(b.oldest).localeCompare(String(a.oldest))||a.customer_id.localeCompare(b.customer_id))){
   const donor=members.find(m=>m.id===row.assignee_id);if(!donor||donor.after<=config.target||!permits(donor,row)||sending.get(row.customer_id))continue;
   const recipient=members.filter(m=>m.id!==donor.id&&m.after<config.target&&permits(m,row)).sort((a,b)=>a.after-b.after||(a.allowed?.size??Infinity)-(b.allowed?.size??Infinity))[0];if(!recipient)continue;
   assignments.push({customerId:row.customer_id,staffId:recipient.id,previousAssigneeId:donor.id,revision:row.revision,oldest:row.oldest});donor.after--;recipient.after++;recipient.added++;
  }
 }
 return{enabled:true,target:config.target,assignments,members:members.map(({id,before,after,added})=>({id,before,after,added}))};
}
function refillUnreadAssignments(store,{clock=Date.now}={}){
 const raw=store.db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting);
 if(!raw||!validate(JSON.parse(raw.value)))return{enabled:false,assigned:0,members:[]};
 return store.transaction(()=>{
  const released=require('./replied-public-pool.cjs').releaseCompletedInTransaction(store);
  const current=store.db.prepare('SELECT value FROM app_settings WHERE key=?').get(setting);
  const plan=planUnreadAssignments(store.db,current?JSON.parse(current.value):null);
  if(!plan.enabled)return{enabled:false,assigned:0,members:[]};
  const at=new Date(clock()).toISOString(),runId=randomUUID();
  const assign=store.db.prepare('UPDATE customer_work SET assignee_id=?,revision=revision+1,updated_at=? WHERE customer_id=? AND assignee_id IS ? AND revision=?');
  for(const item of plan.assignments){
   const result=assign.run(item.staffId,at,item.customerId,item.previousAssigneeId,item.revision);if(result.changes!==1)throw Error('UNREAD_ASSIGNMENT_CONFLICT');
   if(item.previousAssigneeId!==null)assignmentState.preserveTransferDraft(store.db,item.customerId,item.previousAssigneeId);
   assignmentState.bumpAssignment(store.db,item.customerId,{transferred:item.previousAssigneeId!==null});
   store.audit('local-operator','customer.unread_auto_assignment',item.customerId,{runId,assigneeId:item.staffId,previousAssigneeId:item.previousAssigneeId,previousRevision:item.revision,oldestUnread:item.oldest,target:plan.target});
  }
  const result={enabled:true,at,runId,released,target:plan.target,assigned:plan.assignments.length,transferred:plan.assignments.filter(a=>a.previousAssigneeId!==null).length,members:plan.members};
  store.db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(setting+'_last_run',JSON.stringify(result));return result;
 });
}
function createUnreadAssignmentWorker(store,{intervalMs=30000,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>console.error('UNREAD_AUTO_ASSIGNMENT_FAILED')}={}){
 let started=false,closed=false,timer=null,pending=Promise.resolve();
 function schedule(delay){if(closed||!started||timer!==null)return;timer=setTimer(()=>{timer=null;pending=Promise.resolve().then(()=>{if(!closed)refillUnreadAssignments(store);}).catch(onError).finally(()=>schedule(intervalMs));return pending;},delay);timer?.unref?.();}
 return{start(){if(started||closed)return;started=true;schedule(0);},async close(){closed=true;if(timer!==null){clearTimer(timer);timer=null;}await pending;}};
}
module.exports={planUnreadAssignments,refillUnreadAssignments,createUnreadAssignmentWorker};
