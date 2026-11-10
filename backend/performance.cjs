'use strict';
const {createHash}=require('node:crypto');
function route(url){const p=String(url||'').split('?')[0].replace(/^\/maildesk(?=\/)/,'');if(/^\/api\/desk\/customers\//.test(p))return'customer-detail';if(/^\/api\/customers\//.test(p))return'customer-work';const known={'/':'home','/api/bootstrap':'bootstrap','/api/desk/conversations':'conversations','/api/desk/meta':'meta','/api/desk/reply-stats':'reply-stats','/api/send':'send','/api/read':'read','/api/reply-route':'reply-route','/api/desk/order':'order'};return known[p]||'other';}
function createPerformance({emit=record=>console.log(JSON.stringify(record)),clock=()=>performance.now(),requestThresholdMs=2000,sqlThresholdMs=100,loopThresholdMs=1000,setTimer=setInterval,clearTimer=clearInterval}={}){
 const restores=[],seen=new WeakSet();let timer=null,closed=false;
 function log(data){if(closed)return;try{emit({type:'maildesk_performance',at:new Date().toISOString(),...data});}catch{}}
 function observeDatabase(db){if(seen.has(db))return;seen.add(db);const prepare=db.prepare,exec=db.exec;
  function measure(fn,metadata){const start=clock();let failed=false;try{return fn();}catch(e){failed=true;throw e;}finally{const ms=clock()-start;if(ms>=sqlThresholdMs)log({kind:'slow_sql',...metadata,ms:Math.round(ms),failed});}}
  db.prepare=function(sql){const meta={query_id:createHash('sha256').update(String(sql)).digest('hex').slice(0,16),operation:/^\s*(SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE|BEGIN|COMMIT|ROLLBACK)\b/i.exec(sql)?.[1]?.toUpperCase()||'OTHER'};const s=measure(()=>prepare.call(db,sql),{...meta,phase:'prepare'});
   for(const method of ['get','all','run']){const fn=s[method];s[method]=function(...args){return measure(()=>fn.apply(s,args),{...meta,phase:method});};}const iterate=s.iterate;if(iterate)s.iterate=function(...args){const it=iterate.apply(s,args);let elapsed=0,done=false;function step(method,values){const start=clock();let end=false,failed=false;try{const result=it[method](...values);end=result.done||method==='return';return result;}catch(e){end=true;failed=true;throw e;}finally{elapsed+=clock()-start;if(end&&!done){done=true;if(elapsed>=sqlThresholdMs)log({kind:'slow_sql',...meta,phase:'iterate',ms:Math.round(elapsed),failed});}}}return{next(...values){return step('next',values);},return(...values){return step('return',values);},[Symbol.iterator](){return this;}};};return s;
  };
  db.exec=function(sql){return measure(()=>exec.call(db,sql),{query_id:createHash('sha256').update(String(sql)).digest('hex').slice(0,16),operation:'EXEC',phase:'exec'});};
  restores.push(()=>{db.prepare=prepare;db.exec=exec;});
 }
 function observeServer(server,label){const listener=(req,res)=>{const start=clock();let done=false;const finish=aborted=>{if(done)return;done=true;const ms=clock()-start;if(aborted||res.statusCode>=500||ms>=requestThresholdMs)log({kind:'slow_request',server:label,route:route(req.url),method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(req.method)?req.method:'OTHER',status:res.statusCode,ms:Math.round(ms),aborted});};res.once('finish',()=>finish(false));res.once('close',()=>finish(true));};server.prependListener('request',listener);restores.push(()=>server.removeListener('request',listener));}
 function startLoop(){if(timer!==null)return;let last=clock();timer=setTimer(()=>{const now=clock(),delay=now-last-5000;last=now;if(delay>=loopThresholdMs)log({kind:'event_loop_delay',delay_ms:Math.round(delay)});},5000);timer?.unref?.();}
 return{observeDatabase,observeServer,startLoop,close(){if(closed)return;closed=true;if(timer!==null)clearTimer(timer);for(const restore of restores)restore();}};
}
module.exports={createPerformance};
