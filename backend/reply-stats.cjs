'use strict';
const {readSignatures}=require('./signatures.cjs');
function staffHeaders(headers,identity){const result={...headers};delete result['x-maildesk-staff'];delete result['x-maildesk-role'];result['x-maildesk-role']=identity?.role==='admin'?'admin':'staff';const id=require('./staff-identity.cjs').staffId(identity);if(id)result['x-maildesk-staff']=id;return result;}
function sendingActor(store,headers,fallback){const id=headers['x-maildesk-staff'];if(!id)return fallback;if(typeof id!=='string'||!/^(?:dingtalk|password)-[a-f0-9]{64}$/.test(id))throw Error('INVALID_STAFF_ID');store.actor(id);return id;}
function statsRange(params){
 const today=new Date(Date.now()+28800000).toISOString().slice(0,10),expanded=params.has('startDate')||params.has('endDate')||params.has('granularity')||params.has('startHour')||params.has('endHour');
 const date=params.get('date')||today,period=params.get('period')||'day',hour=params.get('hour')||'0';
 function midnight(value){if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))throw Error('INVALID_STATS_RANGE');const n=Date.parse(value+'T00:00:00+08:00');if(!Number.isFinite(n)||new Date(n+28800000).toISOString().slice(0,10)!==value)throw Error('INVALID_STATS_RANGE');return n;}
 if(!['day','hour'].includes(period)||!/^([0-9]|1[0-9]|2[0-3])$/.test(hour))throw Error('INVALID_STATS_RANGE');
 const startDate=expanded?(params.get('startDate')||today):date,endDate=expanded?(params.get('endDate')||startDate):date,granularity=expanded?(params.get('granularity')||'day'):period;
 if(!['day','hour'].includes(granularity))throw Error('INVALID_STATS_RANGE');
 const startHour=params.get('startHour')??'0',endHour=params.get('endHour')??'24';
 if(!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(startHour)||!/^(?:[1-9]|1[0-9]|2[0-4])$/.test(endHour)||Number(endHour)<=Number(startHour))throw Error('INVALID_STATS_RANGE');
 let start=midnight(startDate),end=midnight(endDate)+86400000;if(end<=start)throw Error('INVALID_STATS_RANGE');if(!expanded&&period==='hour'){start+=Number(hour)*3600000;end=start+3600000;}
 return{startHour:Number(startHour),endHour:Number(endHour),date:expanded?startDate:date,period:expanded?granularity:period,hour:!expanded&&period==='hour'?Number(hour):null,startDate,endDate,granularity,timezone:'Asia/Shanghai',start:new Date(start).toISOString(),end:new Date(end).toISOString()};
}
function replyStats(db,params,options={admin:true}){
 const range=statsRange(params),restricted=options.admin!==true,actor=options.actorId||null,ids=restricted&&!actor?[]:options.inboxIds;
 const inboxFilter=column=>ids==null?'':` AND ${column} IN(SELECT value FROM json_each(?))`;
 const bindings=()=>ids==null?[]:[JSON.stringify(ids)];
 // Metadata-only aggregation: neither mail bodies nor attachments are selected. Unique inbox attribution avoids multiplying shared mail.
 const cte=`WITH inbox_shop AS (SELECT inbox_id,CASE WHEN count(*)=1 THEN min(shop_id) END shop_id FROM inbox_shops GROUP BY inbox_id), raw_events AS (
 SELECT m.inbox_id,ish.shop_id,NULL actor_id,m.sent_at at,1 incoming,0 replies FROM messages m LEFT JOIN inbox_shop ish ON ish.inbox_id=m.inbox_id WHERE m.direction='inbound' AND m.sent_at>=? AND m.sent_at<?${inboxFilter('m.inbox_id')}
 UNION ALL SELECT coalesce(r.inbox_id,m.inbox_id),coalesce(nullif(r.shop_id,''),ish.shop_id),o.actor_id,o.created_at,0,1 FROM outgoing o LEFT JOIN outgoing_routes r ON r.outgoing_id=o.id LEFT JOIN messages m ON m.id=o.parent_id LEFT JOIN inbox_shop ish ON ish.inbox_id=coalesce(r.inbox_id,m.inbox_id) WHERE o.status='accepted' AND o.created_at>=? AND o.created_at<?${restricted?' AND o.actor_id=?':''}${inboxFilter('coalesce(r.inbox_id,m.inbox_id)')}), events AS (SELECT * FROM raw_events WHERE CAST(strftime('%H',at,'+8 hours') AS INTEGER)>=${range.startHour} AND CAST(strftime('%H',at,'+8 hours') AS INTEGER)<${range.endHour}) `;
 const args=[range.start,range.end,...bindings(),range.start,range.end,...(restricted?[actor]:[]),...bindings()];
 const total=db.prepare(cte+'SELECT coalesce(sum(incoming),0) incoming,coalesce(sum(replies),0) count FROM events').get(...args);
 const counts=db.prepare(cte+'SELECT actor_id,sum(replies) count FROM events WHERE replies=1 GROUP BY actor_id').all(...args),byId=new Map(counts.map(r=>[r.actor_id,r.count])),codes=readSignatures(db);
 const rows=db.prepare('SELECT id,display_name,active FROM staff').all().filter(s=>(!restricted||s.id===actor)&&((s.active&&s.id!=='local-operator')||byId.has(s.id))).map(s=>({id:s.id,name:s.id==='local-operator'?'历史未归属（本机操作员）':s.display_name,code:codes.find(c=>c.staffId===s.id)?.code||'',count:byId.get(s.id)||0,active:!!s.active}));
 const sort=(a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-CN');rows.sort(sort);
 const shops=db.prepare(cte+"SELECT e.shop_id id,coalesce(s.name,CASE WHEN e.shop_id IS NULL THEN '共享邮箱/未归属' ELSE e.shop_id END) name,sum(incoming) incoming,sum(replies) count FROM events e LEFT JOIN shops s ON s.id=e.shop_id GROUP BY e.shop_id ORDER BY count DESC,name").all(...args).map(r=>({...r,inboxes:[]}));
 const inboxes=db.prepare(cte+'SELECT e.shop_id, e.inbox_id id,coalesce(i.address, e.inbox_id) address,sum(incoming) incoming,sum(replies) count FROM events e LEFT JOIN inboxes i ON i.id=e.inbox_id GROUP BY e.shop_id,e.inbox_id').all(...args);
 for(const i of inboxes){const shop=shops.find(s=>s.id===i.shop_id);shop.inboxes.push({id:i.id,address:i.address,incoming:i.incoming,count:i.count});}
 const format=range.granularity==='hour'?'%Y-%m-%d %H:00':'%Y-%m-%d';
 const buckets=db.prepare(cte+`SELECT strftime('${format}',at,'+8 hours') bucket,sum(incoming) incoming,sum(replies) count FROM events GROUP BY bucket ORDER BY bucket`).all(...args);
 const shopBuckets=db.prepare(cte+`SELECT shop_id,strftime('${format}',at,'+8 hours') bucket,sum(incoming) incoming,sum(replies) count FROM events GROUP BY shop_id,bucket ORDER BY bucket`).all(...args);
 const shopStaff=db.prepare(cte+'SELECT shop_id,actor_id,sum(replies) count FROM events WHERE replies=1 GROUP BY shop_id,actor_id').all(...args);
 for(const shop of shops){shop.buckets=shopBuckets.filter(b=>b.shop_id===shop.id).map(({shop_id,...bucket})=>bucket);shop.rows=shopStaff.filter(r=>r.shop_id===shop.id).map(r=>({...rows.find(s=>s.id===r.actor_id),count:r.count})).sort(sort);}
 return{...range,total:total.count,incomingTotal:total.incoming,rows,shops,buckets,visibility:restricted?'staff':'admin',actorId:restricted?actor:null};
}
function visibleReplyStats(data,identity){
 if(identity?.role==='admin')return data;
 const id=require('./staff-identity.cjs').staffId(identity);
 if(data.shops){if(id&&data.visibility==='staff'&&data.actorId===id)return data;return{...data,total:0,incomingTotal:0,rows:[],shops:[],buckets:[],visibility:'staff',actorId:id||null};}
 const rows=id?data.rows.filter(row=>row.id===id):[];return{date:data.date,period:data.period,hour:data.hour,timezone:data.timezone,start:data.start,end:data.end,total:rows.reduce((sum,row)=>sum+row.count,0),rows};
}
module.exports={staffHeaders,sendingActor,replyStats,visibleReplyStats};
