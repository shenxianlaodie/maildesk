'use strict';
const assignment=require('./assignment-state.cjs');
function saveCustomerWork(store,id,input,{actor,scope=null}){
 scope?.customer(id);store.actor(actor);
 const patch={...input.patch},hasDraft=Object.hasOwn(patch,'draft'),draft=patch.draft;
 if(hasDraft&&(typeof draft!=='string'||draft.length>100000))throw Error('INVALID_DRAFT');
 const personal=assignment.usesAssignmentDraft(store.db,id);
 if(hasDraft&&(personal||scope))delete patch.draft;
 let saved;
 if(personal&&hasDraft&&Object.keys(patch).length===0){
  // Drafts belong to the author and are safe to save after reassignment.
  saved=store.transaction(()=>{assignment.saveAssignmentDraft(store.db,id,actor,draft);return store.db.prepare('SELECT * FROM customer_work WHERE customer_id=?').get(id);});
 }else{
  saved=store.saveWork(id,patch,input.revision,actor);
  if(hasDraft){if(personal)assignment.saveAssignmentDraft(store.db,id,actor,draft);else if(scope)scope.saveDraft(id,draft);}
 }
 if(scope)saved=scope.work(id,saved);
 if(personal)saved={...saved,draft:assignment.readAssignmentDraft(store.db,id,actor)};
 return saved;
}
module.exports={saveCustomerWork};
