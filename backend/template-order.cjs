'use strict';
function templateOrder(db,actor,ids){
 if(!actor||!db.prepare('SELECT id FROM staff WHERE id=? AND active=1').get(actor))throw Error('STAFF_REQUIRED');
 const key='template_order:'+actor;
 const templates=db.prepare('SELECT id FROM templates ORDER BY updated_at DESC').all().map(t=>t.id);
 if(ids!==undefined){
  if(!Array.isArray(ids)||ids.length>10000||ids.some(id=>typeof id!=='string'||!templates.includes(id))||new Set(ids).size!==ids.length)throw Error('INVALID_TEMPLATE_ORDER');
  db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(ids));
 }
 const saved=JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value||'[]');
 return [...saved.filter(id=>templates.includes(id)),...templates.filter(id=>!saved.includes(id))];
}
module.exports={templateOrder};
