'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {DatabaseSync}=require('node:sqlite');
const {normalizeLegacy}=require('./legacy-order-map.cjs');
const {mergeOrders}=require('./combined-orders.cjs');
const {fetchOrderDetail}=require('./order-detail-refresh.cjs');
let readShopToken;
async function pgShopToken(domain){
 if(!readShopToken){if(!process.env.ORDER_DATABASE_URL)throw Error('ORDER_TOKEN_DATABASE_UNAVAILABLE');const database=require('./order-database.cjs').createOrderDatabase(process.env.ORDER_DATABASE_URL);readShopToken=require('./shop-token.cjs').createShopTokenReader(database);}
 return readShopToken(domain);
}
const source=new DatabaseSync(workerData.source,{readOnly:true}),cache=new DatabaseSync(workerData.cache);
source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');cache.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
cache.exec(`CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,domain TEXT NOT NULL,provider TEXT NOT NULL,number TEXT NOT NULL,updated TEXT,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS legacy_identity ON orders(domain,provider);
 CREATE INDEX IF NOT EXISTS legacy_number ON orders(domain,number);
 CREATE TABLE IF NOT EXISTS terms(id TEXT NOT NULL,kind TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(id,kind,value));
 CREATE INDEX IF NOT EXISTS legacy_term_value ON terms(kind,value,id);
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT);`);
cache.exec(`CREATE TABLE IF NOT EXISTS live_orders AS SELECT * FROM orders WHERE 0;
 CREATE UNIQUE INDEX IF NOT EXISTS live_orders_id ON live_orders(id);
 CREATE TABLE IF NOT EXISTS live_terms AS SELECT * FROM terms WHERE 0;
 CREATE INDEX IF NOT EXISTS live_term_value ON live_terms(kind,value,id);
 CREATE INDEX IF NOT EXISTS live_term_order ON live_terms(id,kind,value);
 CREATE INDEX IF NOT EXISTS live_order_identity ON live_orders(domain,provider);
 CREATE INDEX IF NOT EXISTS live_order_number ON live_orders(domain,number);
 CREATE VIEW IF NOT EXISTS available_orders AS SELECT * FROM orders WHERE id NOT IN(SELECT id FROM live_orders) UNION ALL SELECT * FROM live_orders;
 CREATE VIEW IF NOT EXISTS available_terms AS SELECT * FROM terms UNION ALL SELECT * FROM live_terms;`);
let available=!!cache.prepare("SELECT value FROM metadata WHERE key='updated'").get(),refreshError=null;
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function refresh(){
 try{
  cache.exec('DROP TABLE IF EXISTS next_orders; DROP TABLE IF EXISTS next_terms; CREATE TABLE next_orders AS SELECT * FROM orders WHERE 0; CREATE UNIQUE INDEX next_orders_id ON next_orders(id); CREATE TABLE next_terms AS SELECT * FROM terms WHERE 0;');
  const put=cache.prepare('INSERT INTO next_orders VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET domain=excluded.domain,provider=excluded.provider,number=excluded.number,updated=excluded.updated,data=excluded.data WHERE COALESCE(excluded.updated,\'\')>=COALESCE(next_orders.updated,\'\')');
  for(const table of ['order_index','order_core']){
   if(!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
   let after=0;while(true){const rows=source.prepare('SELECT rowid AS cursor_row,* FROM '+table+' WHERE rowid>? ORDER BY rowid LIMIT 200').all(after);if(!rows.length)break;
    cache.exec('BEGIN');try{for(const r of rows){let o=normalizeLegacy(r,table==='order_core');if(o){const previous=cache.prepare('SELECT data FROM next_orders WHERE id=?').get(o.id);if(previous)o=mergeOrders([],[JSON.parse(previous.data),o])[0];put.run(o.id,o.shop_domain,o.provider_id,o.order_number.toUpperCase(),o.provider_updated_at,JSON.stringify(o));}}cache.exec('COMMIT');}catch(e){cache.exec('ROLLBACK');throw e;}
    after=rows[rows.length-1].cursor_row;await pause();
   }
  }
  const term=cache.prepare('INSERT INTO next_terms VALUES(?,?,?)');let after=0;
  while(true){const rows=cache.prepare('SELECT rowid AS cursor_row,* FROM next_orders WHERE rowid>? ORDER BY rowid LIMIT 200').all(after);if(!rows.length)break;cache.exec('BEGIN');try{for(const r of rows){const o=JSON.parse(r.data);for(const n of new Set([o.order_number.toLowerCase(),o.provider_id.toLowerCase()]))term.run(o.id,'number',n);for(const e of o.emails)term.run(o.id,'email',e);for(const s of o.shipments)term.run(o.id,'tracking',s.tracking_number.toLowerCase());}cache.exec('COMMIT');}catch(e){cache.exec('ROLLBACK');throw e;}after=rows[rows.length-1].cursor_row;await pause();}
  // Include alternate checkout/contact emails from the bridge's dedicated email index.
  if(source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='order_email_index'").get()){
   const find=cache.prepare('SELECT id FROM next_orders WHERE domain=? AND provider=?');cache.exec('CREATE INDEX next_identity ON next_orders(domain,provider)');let cursor=0;
   while(true){const rows=source.prepare('SELECT rowid AS cursor_row,store_subdomain,order_id,email_norm FROM order_email_index WHERE rowid>? ORDER BY rowid LIMIT 500').all(cursor);if(!rows.length)break;cache.exec('BEGIN');try{for(const r of rows){const domain=r.store_subdomain.replace(/\.myshoplaza\.com$/,'')+'.myshoplaza.com',o=find.get(domain,r.order_id);if(o&&r.email_norm)term.run(o.id,'email',r.email_norm.toLowerCase());}cache.exec('COMMIT');}catch(e){cache.exec('ROLLBACK');throw e;}cursor=rows[rows.length-1].cursor_row;await pause();}
  }
  cache.exec('BEGIN');try{cache.exec('DELETE FROM orders; INSERT INTO orders SELECT * FROM next_orders; DELETE FROM terms; INSERT OR IGNORE INTO terms SELECT * FROM next_terms; DROP TABLE next_orders; DROP TABLE next_terms;');cache.prepare("INSERT OR REPLACE INTO metadata VALUES('updated',?)").run(new Date().toISOString());cache.exec('COMMIT');}catch(e){cache.exec('ROLLBACK');throw e;}
  available=true;refreshError=null;parentPort.postMessage({status:'ready',count:cache.prepare('SELECT count(*) n FROM orders').get().n});
 }catch{refreshError='LEGACY_ORDER_DATABASE_UNAVAILABLE';parentPort.postMessage({status:'refresh-error'});}
}
// Keep the imported legacy index stable; store API details are refreshed separately.
const initial=available?Promise.resolve():refresh();
function rows(sql,args=[]){sql=sql.replace(/\borders\b/g,'available_orders').replace(/\bterms\b/g,'available_terms');return cache.prepare(sql).all(...args).map(r=>{let o=JSON.parse(r.data);if(o.refreshed_at){const base=cache.prepare('SELECT data FROM orders WHERE id=?').get(o.id);if(base)o=mergeOrders([],[JSON.parse(base.data),o])[0];}o.emails=[...new Set([...o.emails||[],...cache.prepare("SELECT value FROM available_terms WHERE id=? AND kind='email'").all(o.id).map(r=>r.value)])];return o;});}
let refreshing=Promise.resolve();
function refreshOrder(input,{force=false}={}){const operation=refreshing.then(async()=>{const cached=cache.prepare('SELECT data FROM live_orders WHERE domain=? AND provider=?').get(input.shop_domain,input.provider_id);if(cached&&!force){const o=JSON.parse(cached.data);if(Date.now()-Date.parse(o.refreshed_at)<60000)return o;}const o=await fetchOrderDetail(pgShopToken,input);cache.exec('BEGIN');try{cache.prepare('INSERT OR REPLACE INTO live_orders VALUES(?,?,?,?,?,?)').run(o.id,o.shop_domain,o.provider_id,o.order_number.toUpperCase(),o.provider_updated_at,JSON.stringify(o));cache.prepare('DELETE FROM live_terms WHERE id=?').run(o.id);const put=cache.prepare('INSERT INTO live_terms VALUES(?,?,?)');for(const n of new Set([o.order_number.toLowerCase(),o.provider_id.toLowerCase()]))put.run(o.id,'number',n);for(const e of o.emails)put.run(o.id,'email',e);for(const s of o.shipments)put.run(o.id,'tracking',s.tracking_number.toLowerCase());cache.exec('COMMIT');}catch(e){cache.exec('ROLLBACK');throw e;}return o;});refreshing=operation.catch(()=>{}).then(()=>new Promise(resolve=>setTimeout(resolve,600)));return operation;}
parentPort.on('message',async({id,method,args})=>{try{if(!available)await initial;if(!available)throw Error(refreshError||'LEGACY_ORDER_DATABASE_UNAVAILABLE');let result;
 if(method==='refresh')result=await refreshOrder(args[0],args[1]);
 else if(method==='get')result=rows('SELECT data FROM orders WHERE id=?',[args[0]])[0]||null;
 else if(method==='identifiers')result=rows("SELECT data FROM orders WHERE id IN(SELECT id FROM terms WHERE kind IN ('number','tracking') AND value IN(SELECT value FROM json_each(?)))",[JSON.stringify(args[0].map(n=>n.toLowerCase()))]);
 else if(method==='byKeys'){const found=new Map();for(const k of args[0])for(const o of [...rows('SELECT data FROM orders WHERE domain=? AND provider=?',[k.domain,k.provider]),...rows('SELECT data FROM orders WHERE domain=? AND number=?',[k.domain,k.number])])found.set(o.id,o);result=[...found.values()];}
 else if(method==='forEmails')result=rows("SELECT DISTINCT o.data FROM orders o WHERE o.id IN(SELECT id FROM terms WHERE kind='email' AND value IN(SELECT value FROM json_each(?))) OR o.id IN(SELECT value FROM json_each(?))",[JSON.stringify(args[0]),JSON.stringify(args[1])]);
 else if(method==='search'){const q=String(args[0]).trim().toLowerCase(),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';result=q?rows("SELECT data FROM orders WHERE id IN(SELECT id FROM terms WHERE kind IN ('number','email','tracking') AND value=?) ORDER BY updated DESC LIMIT 10001",[q]):[];if(q&&!result.length&&!args[1]?.exactOnly)result=rows("SELECT data FROM orders WHERE id IN(SELECT id FROM terms WHERE value LIKE ? ESCAPE '\\') ORDER BY updated DESC LIMIT 10001",[pattern]);if(result.length>10000)throw Error('ORDER_RESULT_LIMIT');}
 else if(method==='shops')result=cache.prepare('SELECT DISTINCT domain FROM orders').all().map(r=>({store_subdomain:r.domain,store_name:r.domain}));
 else if(method==='status')result={autoRefresh:false,updated:cache.prepare("SELECT value FROM metadata WHERE key='updated'").get()?.value,error:refreshError,count:cache.prepare('SELECT count(*) n FROM orders').get().n};
 else throw Error('INVALID_LEGACY_METHOD');
 parentPort.postMessage({id,result});
 }catch(e){parentPort.postMessage({id,error:['ORDER_RESULT_LIMIT','INVALID_LEGACY_METHOD'].includes(e.message)||/^ORDER_REFRESH_[A-Z_]+$/.test(e.message)?e.message:'ORDER_DATABASE_UNAVAILABLE'});}});
