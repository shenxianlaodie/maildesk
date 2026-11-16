(function(root){
 'use strict';
 function createWatcher({read,onChange,isVisible=()=>true,intervalMs=15000,setTimer=setTimeout,clearTimer=clearTimeout}){
  let current=null,timer=null,version=0,closed=false;
  function schedule(){if(closed||!current||timer!==null)return;timer=setTimer(()=>{timer=null;void check();},intervalMs);}
  function invalidate(id,next){if(!current||current.id!==id||current.blocked)return;current.blocked=true;onChange(id,next);}
  async function check(){
   const item=current,seq=version;
   if(closed||!item||item.busy||item.blocked||!isVisible()){schedule();return;}
   item.busy=true;
   try{const result=await read(item.id);if(closed||current!==item||seq!==version)return;const next=result.assignment;
    if(next&&(next.assigneeId!==item.snapshot.assigneeId||next.generation!==item.snapshot.generation))invalidate(item.id,result);
   }catch{/* A transient network error is not evidence of reassignment. */}
   finally{item.busy=false;if(!closed&&current===item&&seq===version)schedule();}
  }
  function watch(id,snapshot){version++;if(timer!==null){clearTimer(timer);timer=null;}current=id&&snapshot?{id,snapshot:{...snapshot},blocked:false,busy:false}:null;if(current)void check();}
  function close(){closed=true;version++;current=null;if(timer!==null)clearTimer(timer);timer=null;}
  return{watch,check,invalidate,blocked:id=>!!current&&current.id===id&&current.blocked,close};
 }
 const api={createWatcher};if(typeof module==='object'&&module.exports)module.exports=api;else root.MaildeskAssignmentWatch=api;
})(typeof window==='object'?window:globalThis);
