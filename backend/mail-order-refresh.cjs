'use strict';
function orderNumbers(subject,body){return [...new Set(((String(subject||'')+'\n'+String(body||'')).slice(0,20000).match(/\b[A-Za-z0-9][A-Za-z0-9_-]{4,49}\b/g)||[]).filter(s=>/[A-Za-z]/.test(s)&&/\d/.test(s)).map(s=>s.toUpperCase()))].slice(0,12);}
function mailOrderRefresh(store,orders,{interval=1000,clock=Date.now}={}){
 const {refreshSlot,installRefreshJobs,enqueueRefresh}=require('./order-refresh-schedule.cjs');
 const db=store.db;installRefreshJobs(db);
 db.exec("UPDATE customer_order_refresh_jobs SET status='pending' WHERE status='running'");
 db.prepare("INSERT OR IGNORE INTO app_settings VALUES('order_refresh_slot',?)").run(refreshSlot(clock()));db.exec(`CREATE TABLE IF NOT EXISTS mail_order_refresh_jobs(message_id TEXT PRIMARY KEY REFERENCES messages(id),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL DEFAULT '',updated_at TEXT,last_error TEXT,refreshed INTEGER NOT NULL DEFAULT 0);`);
 // Backfill the latest inbound message per existing customer once; later imports enqueue themselves.
 if(!db.prepare("SELECT 1 FROM app_settings WHERE key='mail_order_refresh_seeded'").get()){store.transaction(()=>{db.exec("INSERT OR IGNORE INTO mail_order_refresh_jobs(message_id) SELECT id FROM messages m WHERE direction='inbound' AND id=(SELECT id FROM messages x WHERE x.customer_id=m.customer_id AND x.direction='inbound' ORDER BY x.sent_at DESC,x.id DESC LIMIT 1)");db.prepare("INSERT INTO app_settings VALUES('mail_order_refresh_seeded','true')").run();});}
 require('./order-association.cjs').installAssociation(db);
 if(!db.prepare("SELECT 1 FROM app_settings WHERE key='order_association_v2_seeded'").get()){store.transaction(()=>{db.exec("UPDATE mail_order_refresh_jobs SET status='pending',attempts=0,next_at='',last_error=NULL WHERE message_id IN(SELECT id FROM messages m WHERE direction='inbound' AND id=(SELECT id FROM messages x WHERE x.customer_id=m.customer_id AND x.direction='inbound' ORDER BY x.sent_at DESC,x.id DESC LIMIT 1))");db.prepare("INSERT INTO app_settings VALUES('order_association_v2_seeded','true')").run();});}
 let stopped=false,timer,pending=Promise.resolve();
 function enqueue(id){db.prepare("INSERT OR IGNORE INTO mail_order_refresh_jobs(message_id) SELECT id FROM messages WHERE id=? AND direction='inbound'").run(id);}
 async function processMessage(m){
  await require('./order-association.cjs').associateMessage(store,orders,m);
  return{refreshed:0,lastError:null};
 }
 function schedule(){const slot=refreshSlot(clock());if(db.prepare("SELECT value FROM app_settings WHERE key='order_refresh_slot'").get().value===slot)return;
  store.transaction(()=>{for(const c of db.prepare('SELECT id FROM customers').all())enqueueRefresh(db,c.id,{now:clock()});db.prepare("UPDATE app_settings SET value=? WHERE key='order_refresh_slot'").run(slot);});
 }
 async function refreshNext(){
  const job=db.prepare("SELECT * FROM customer_order_refresh_jobs WHERE status='pending' ORDER BY manual DESC,requested_at,customer_id LIMIT 1").get();if(!job)return;
  db.prepare("UPDATE customer_order_refresh_jobs SET status='running' WHERE customer_id=?").run(job.customer_id);
  let refreshed=0,failed=0,lastError=null;
  try{const rows=await orders.forCustomer(job.customer_id);for(const o of rows){if(stopped){db.prepare("UPDATE customer_order_refresh_jobs SET status='pending' WHERE customer_id=?").run(job.customer_id);return;}try{await orders.refresh(o,{force:job.manual===1});refreshed++;}catch(e){failed++;lastError=/^ORDER_[A-Z_]+$/.test(e.message)?e.message:'ORDER_REFRESH_UNAVAILABLE';}}}catch(e){failed++;lastError=/^ORDER_[A-Z_]+$/.test(e.message)?e.message:'ORDER_REFRESH_UNAVAILABLE';}
  db.prepare('UPDATE customer_order_refresh_jobs SET status=?,completed_at=?,refreshed=?,failed=?,last_error=? WHERE customer_id=?').run(failed?(refreshed?'partial':'failed'):'done',new Date(clock()).toISOString(),refreshed,failed,lastError,job.customer_id);
 }
 async function tick(){if(stopped)return;schedule();const m=db.prepare("SELECT m.*,j.attempts FROM mail_order_refresh_jobs j JOIN messages m ON m.id=j.message_id WHERE j.status IN ('pending','retry') AND j.next_at<=? ORDER BY m.sent_at DESC LIMIT 1").get(new Date().toISOString());if(m){let result;try{result=await processMessage(m);}catch(e){result={refreshed:0,lastError:/^ORDER_[A-Z_]+$/.test(e.message)?e.message:'ORDER_REFRESH_UNAVAILABLE'};}const attempts=m.attempts+1,status=result.lastError?(attempts<3?'retry':'failed'):'done';db.prepare('UPDATE mail_order_refresh_jobs SET status=?,attempts=?,next_at=?,updated_at=?,last_error=?,refreshed=? WHERE message_id=?').run(status,attempts,new Date(Date.now()+attempts*60000).toISOString(),new Date().toISOString(),result.lastError,result.refreshed,m.id);}await refreshNext();if(!stopped){timer=setTimeout(()=>{pending=tick();},interval);timer.unref();}}
 return{enqueue,processMessage,schedule,refreshNext,start(){pending=tick();},async close(){stopped=true;clearTimeout(timer);await pending;}};
}
module.exports={mailOrderRefresh,orderNumbers};
