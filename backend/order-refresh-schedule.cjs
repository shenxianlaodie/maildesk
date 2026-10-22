'use strict';
// Slot keys use Beijing time, independent of the server's timezone.
function refreshSlot(now=Date.now()){
 const local=new Date(Number(now)+8*3600000),hour=local.getUTCHours();
 if(hour<9)local.setUTCDate(local.getUTCDate()-1);
 return local.toISOString().slice(0,10)+'T09:00';
}
function installRefreshJobs(db){db.exec(`CREATE TABLE IF NOT EXISTS customer_order_refresh_jobs(customer_id TEXT PRIMARY KEY REFERENCES customers(id),status TEXT NOT NULL,requested_at TEXT NOT NULL,completed_at TEXT,manual INTEGER NOT NULL DEFAULT 0,refreshed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,last_error TEXT);`);}
function enqueueRefresh(db,customerId,{manual=false,now=Date.now()}={}){
 if(!db.prepare('SELECT 1 FROM customers WHERE id=?').get(customerId))throw Error('CUSTOMER_NOT_FOUND');
 installRefreshJobs(db);
 const previous=db.prepare('SELECT * FROM customer_order_refresh_jobs WHERE customer_id=?').get(customerId);
 if(previous&&['pending','running'].includes(previous.status)){if(manual)db.prepare('UPDATE customer_order_refresh_jobs SET manual=1 WHERE customer_id=?').run(customerId);return;}
 db.prepare("INSERT OR REPLACE INTO customer_order_refresh_jobs(customer_id,status,requested_at,manual) VALUES(?,'pending',?,?)").run(customerId,new Date(now).toISOString(),+manual);
}
function refreshStatus(db,id){installRefreshJobs(db);return db.prepare('SELECT status,requested_at,completed_at,refreshed,failed,last_error FROM customer_order_refresh_jobs WHERE customer_id=?').get(id)||{status:'idle'};}
module.exports={refreshSlot,installRefreshJobs,enqueueRefresh,refreshStatus};
