'use strict';
const normalize=v=>String(v||'').normalize('NFKC').trim().replace(/^[#＃]+/,'').replace(/[‐‑–—]/g,'-').toUpperCase();
function identifiers(subject,body){const text=(String(subject||'')+'\n'+String(body||'')).normalize('NFKC').replace(/[‐‑–—]/g,'-').slice(0,20000),tokens=text.match(/\b[A-Za-z0-9][A-Za-z0-9_-]{4,69}\b/g)||[];const result=new Set();for(const token of tokens){if(!/[A-Za-z]/.test(token)||!/[0-9]/.test(token))continue;result.add(normalize(token));const suffix=token.match(/[-_]([a-z]{2,}\d{3,})$/i);if(suffix)result.add(normalize(suffix[1]));}return [...result].slice(0,24);}
function installAssociation(db){db.exec(`CREATE TABLE IF NOT EXISTS order_match_candidates(message_id TEXT NOT NULL REFERENCES messages(id),order_id TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(message_id,order_id));
 CREATE TABLE IF NOT EXISTS message_order_matches(message_id TEXT NOT NULL REFERENCES messages(id),order_id TEXT NOT NULL,PRIMARY KEY(message_id,order_id));`);}
function threadOrderIds(db,m){const found=new Set(),seen=new Set();let current=m;for(let depth=0;depth<30&&current?.in_reply_to;depth++){
 const ref=current.in_reply_to.trim();if(seen.has(ref))break;seen.add(ref);
 let parent=db.prepare('SELECT * FROM messages WHERE rfc_message_id=? AND customer_id=? AND inbox_id=? LIMIT 1').get(ref,m.customer_id,m.inbox_id);
 if(!parent){const outgoing=db.prepare("SELECT o.parent_id,r.order_id FROM outgoing o JOIN outgoing_routes r ON r.outgoing_id=o.id JOIN messages p ON p.id=o.parent_id WHERE o.customer_id=? AND p.inbox_id=? AND o.status='accepted' AND ('<'||o.id||'@'||substr(r.from_address,instr(r.from_address,'@')+1)||'>')=?").get(m.customer_id,m.inbox_id,ref);if(!outgoing)break;if(outgoing.order_id)found.add(outgoing.order_id);parent=db.prepare('SELECT * FROM messages WHERE id=?').get(outgoing.parent_id);}
 if(!parent)break;for(const r of db.prepare('SELECT order_id FROM message_order_matches WHERE message_id=? UNION SELECT order_id FROM external_order_links WHERE message_id=? AND customer_id=?').all(parent.id,parent.id,m.customer_id))found.add(r.order_id);current=parent;
 }return [...found];}
function narrow(orders,allowed){if(orders.length<=1)return orders;const scoped=orders.filter(o=>allowed.has(o.shop_id));return scoped.length?scoped:orders;}
async function associateMessage(store,orders,m){
 const db=store.db;installAssociation(db);
 const confirmed=db.prepare('SELECT order_id FROM message_order_matches WHERE message_id=?').all(m.id);
 if(confirmed.length===1){try{const o=await orders.get(confirmed[0].order_id);if(o){db.prepare('DELETE FROM order_match_candidates WHERE message_id=?').run(m.id);return{orders:[o],candidateCount:0,reason:'已确认关联'};}}catch(e){if(e.message!=='ORDER_NOT_FOUND')throw e;}}
 const tokens=identifiers(m.subject,m.body_text),set=new Set(tokens),allowed=new Set(db.prepare('SELECT shop_id FROM inbox_shops WHERE inbox_id=?').all(m.inbox_id).map(r=>r.shop_id));
 const matches=orders.matchIdentifiers?await orders.matchIdentifiers(tokens):[...new Map((await Promise.all(tokens.map(t=>orders.search(t)))).flat().map(o=>[o.id,o])).values()];
 const direct=matches.filter(o=>[o.order_number,o.provider_id].some(v=>set.has(normalize(v)))),tracking=matches.filter(o=>(o.shipments||[]).some(s=>set.has(normalize(s.tracking_number))));
 let candidates,reason;
 if(direct.length){candidates=narrow(direct,allowed);reason='邮件订单号';}
 else if(tracking.length){candidates=narrow(tracking,allowed);reason='邮件物流单号';}
 else{const threaded=[];for(const id of threadOrderIds(db,m)){try{threaded.push(await orders.get(id));}catch(e){if(e.message!=='ORDER_NOT_FOUND')throw e;}}if(threaded.length){candidates=narrow([...new Map(threaded.map(o=>[o.id,o])).values()],allowed);reason='同一邮件线程';}else{candidates=narrow(await orders.forCustomer(m.customer_id),allowed);reason='订单邮箱或已有手动关联';}}
 // Conflicting explicit order/tracking evidence must be reviewed rather than silently choosing one.
 if(direct.length&&tracking.length){const others=tracking.filter(t=>!candidates.some(o=>o.id===t.id)&&(!allowed.size||allowed.has(t.shop_id)));if(others.length){candidates=[...new Map([...candidates,...others].map(o=>[o.id,o])).values()];reason='订单号与物流单号需核对';}}
 if(reason==='订单邮箱或已有手动关联'){db.prepare('DELETE FROM order_match_candidates WHERE message_id=?').run(m.id);return{orders:candidates,candidateCount:0,reason};}
 const unique=candidates.length===1&&(!allowed.size||allowed.has(candidates[0].shop_id));
 if(unique){await orders.link({customerId:m.customer_id,orderId:candidates[0].id,messageId:m.id},'local-operator');}
 store.transaction(()=>{db.prepare('DELETE FROM order_match_candidates WHERE message_id=?').run(m.id);if(unique)db.prepare('INSERT OR IGNORE INTO message_order_matches VALUES(?,?)').run(m.id,candidates[0].id);else for(const o of candidates)db.prepare('INSERT INTO order_match_candidates VALUES(?,?,?)').run(m.id,o.id,JSON.stringify({id:o.id,order_number:o.order_number,shop_name:o.shop_name,reason,shopMismatch:allowed.size>0&&!allowed.has(o.shop_id)}));});
 // Ambiguous candidates are not refreshed or linked until an operator confirms them.
 return{orders:unique?[candidates[0]]:[],candidateCount:unique?0:candidates.length,reason};
}
module.exports={normalize,identifiers,installAssociation,threadOrderIds,associateMessage};
