'use strict';
const {createHash}=require('node:crypto');
const {readSignatures}=require('./signatures.cjs');
function staffHeaders(headers,identity){
 const result={...headers};delete result['x-maildesk-staff'];
 const id=require('./staff-identity.cjs').staffId(identity);if(id)result['x-maildesk-staff']=id;
 return result;
}
function sendingActor(store,headers,fallback){
 const id=headers['x-maildesk-staff'];if(!id)return fallback;
 if(typeof id!=='string'||!/^(?:dingtalk|password)-[a-f0-9]{64}$/.test(id))throw Error('INVALID_STAFF_ID');
 store.actor(id);return id;
}
function replyStats(db,params){
 const date=params.get('date')||new Date(Date.now()+8*3600000).toISOString().slice(0,10),period=params.get('period')||'day',hour=params.get('hour')||'0';
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||!['day','hour'].includes(period)||!/^([0-9]|1[0-9]|2[0-3])$/.test(hour))throw Error('INVALID_STATS_RANGE');
 const midnight=Date.parse(date+'T00:00:00+08:00');
 if(!Number.isFinite(midnight)||new Date(midnight+8*3600000).toISOString().slice(0,10)!==date)throw Error('INVALID_STATS_RANGE');
 const start=midnight+(period==='hour'?Number(hour)*3600000:0),end=start+(period==='hour'?3600000:86400000);
 const counts=db.prepare("SELECT actor_id,count(*) count FROM outgoing WHERE status='accepted' AND created_at>=? AND created_at<? GROUP BY actor_id").all(new Date(start).toISOString(),new Date(end).toISOString());
 const byId=new Map(counts.map(r=>[r.actor_id,r.count])),codes=readSignatures(db);
 const rows=db.prepare('SELECT id,display_name,active FROM staff').all().filter(s=>(s.active&&s.id!=='local-operator')||byId.has(s.id)).map(s=>({id:s.id,name:s.id==='local-operator'?'历史未归属（本机操作员）':s.display_name,code:codes.find(c=>c.staffId===s.id)?.code||'',count:byId.get(s.id)||0,active:!!s.active})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN'));
 return {date,period,hour:period==='hour'?Number(hour):null,timezone:'Asia/Shanghai',start:new Date(start).toISOString(),end:new Date(end).toISOString(),total:counts.reduce((n,r)=>n+r.count,0),rows};
}
module.exports={staffHeaders,sendingActor,replyStats};
