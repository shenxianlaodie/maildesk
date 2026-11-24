'use strict';
const assignment=require('./assignment-state.cjs');
// Called inside the caller's transaction, so new inbound mail cannot race the release.
function releaseCompletedInTransaction(store,{customerId=null,actor='local-operator',limit=200}={}){
 require('./mailbox-permissions.cjs').install(store.db);
 const candidates=store.db.prepare(`SELECT w.customer_id,w.assignee_id,w.revision FROM customer_work w
 WHERE w.assignee_id IS NOT NULL ${customerId?'AND w.customer_id=?':''}
 AND EXISTS(SELECT 1 FROM outgoing o WHERE o.customer_id=w.customer_id AND o.status='accepted')
 AND NOT EXISTS(SELECT 1 FROM outgoing o WHERE o.customer_id=w.customer_id AND o.status IN ('sending','unknown'))
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.customer_id=w.customer_id AND m.direction='inbound'
  AND NOT EXISTS(SELECT 1 FROM outgoing o WHERE o.parent_id=m.id AND o.status='accepted')
  AND NOT EXISTS(SELECT 1 FROM messages r WHERE r.customer_id=w.customer_id AND r.direction='outbound' AND r.sent_at>=m.sent_at))
 ORDER BY w.updated_at,w.customer_id`).all(...(customerId?[customerId]:[]));
 const scopedPending=new Map();
 const rows=candidates.filter(row=>{
  if(!scopedPending.has(row.assignee_id)){
   const access=store.db.prepare('SELECT inbox_ids FROM staff_mailbox_access WHERE staff_id=?').get(row.assignee_id);
   let pending=[];if(access){const scope=require('./mailbox-permissions.cjs').createScope(store,row.assignee_id,JSON.parse(access.inbox_ids));
    pending=store.db.prepare(scope.cte+`SELECT w.customer_id FROM customer_work w WHERE w.assignee_id=? ${customerId?'AND w.customer_id=?':''} AND EXISTS(SELECT 1 FROM messages m WHERE m.customer_id=w.customer_id AND m.direction='inbound' AND NOT EXISTS(SELECT 1 FROM outgoing o WHERE o.parent_id=m.id AND o.status IN ('accepted','demo')) AND NOT EXISTS(SELECT 1 FROM messages r WHERE r.customer_id=w.customer_id AND r.direction='outbound' AND r.sent_at>=m.sent_at))`).all(row.assignee_id,...(customerId?[customerId]:[]));
   }scopedPending.set(row.assignee_id,new Set(pending.map(r=>r.customer_id)));
  }return !scopedPending.get(row.assignee_id).has(row.customer_id);
 }).slice(0,limit);
 const at=new Date().toISOString();
 for(const row of rows){
  assignment.preserveTransferDraft(store.db,row.customer_id,row.assignee_id);
  const changed=store.db.prepare('UPDATE customer_work SET assignee_id=NULL,revision=revision+1,updated_at=? WHERE customer_id=? AND assignee_id=? AND revision=?').run(at,row.customer_id,row.assignee_id,row.revision);
  if(changed.changes!==1)throw Error('REPLIED_RELEASE_CONFLICT');
  assignment.bumpAssignment(store.db,row.customer_id,{transferred:true});
  store.audit(actor,'customer.replied_public_pool',row.customer_id,{previousAssigneeId:row.assignee_id,assigneeId:null,reason:'replied_without_pending_inbound'});
 }
 return rows.length;
}
module.exports={releaseCompletedInTransaction};
