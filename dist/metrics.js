(function(root){
  'use strict';
  function refundByPercent(paid, refunded, percent, basis='paid') {
    const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.MailCore;
    if(!/^\d+(?:\.\d{1,2})?$/.test(String(percent).trim())) throw new Error('比例须为 0–100，最多两位小数');
    const p = C.cents(percent);
    if(p>10000) throw new Error('退款比例不能超过 100%');
    if(!['paid','remaining'].includes(basis)) throw new Error('计算基数无效');
    const total=C.cents(paid), previous=C.cents(refunded);
    if(previous>total) throw new Error('已退款超过实付金额，请核对订单');
    const base=basis==='paid'?total:total-previous;
    const requested=Number((BigInt(base)*BigInt(p)+5000n)/10000n);
    return {...C.calculateRefund(paid,refunded,(requested/100).toFixed(2)),percent:Number(percent),basis,base};
  }
  function analyze({orders,messages,replies,from,to,shop=''}) {
    const start=Date.parse(from+'T00:00:00+08:00'),end=Date.parse(to+'T23:59:59.999+08:00');
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>end) throw new Error('请选择有效日期范围');
    const stamp=s=>Date.parse(s.length===10?s+'T00:00:00+08:00':s.length===19?s+'+08:00':s);
    const inRange=d=>stamp(d)>=start&&stamp(d)<=end;
    const seen=new Set();
    const incoming=messages.filter(m=>{const key=m.email.toLowerCase()+'|'+(m.messageId||m.id);if(seen.has(key))return false;seen.add(key);return true;});
    const scoped=incoming.filter(m=>inRange(m.at)&&(!shop||m.shop===shop));
    const timings=scoped.map(m=>{const reply=replies.filter(r=>r.inReplyTo===m.messageId&&r.customer===m.email&&stamp(r.at)>=stamp(m.at)).sort((a,b)=>stamp(a.at)-stamp(b.at))[0];return {m,reply,minutes:reply?(stamp(reply.at)-stamp(m.at))/60000:null};});
    const replied=timings.filter(t=>t.reply);
    const agentRows=[...new Set(replied.map(t=>t.reply.agent))].map(agent=>{const rows=replied.filter(t=>t.reply.agent===agent);return {agent,count:rows.length,average:rows.reduce((n,t)=>n+t.minutes,0)/rows.length,withinHour:rows.filter(t=>t.minutes<=60).length/rows.length};});
    const cohort=orders.filter(o=>inRange(o.date)&&(!shop||o.shop===shop));
    const storeRows=[...new Set(cohort.map(o=>o.shop))].map(name=>{const os=cohort.filter(o=>o.shop===name);const currencies=[...new Set(os.map(o=>o.currency))];return {shop:name,count:os.length,refunded:os.filter(o=>o.refunded>0).length,rate:os.filter(o=>o.refunded>0).length/os.length,amounts:currencies.map(currency=>{const group=os.filter(o=>o.currency===currency);const paid=group.reduce((n,o)=>n+Math.round(o.amount*100),0),refunded=group.reduce((n,o)=>n+Math.round(o.refunded*100),0);return {currency,paid,refunded,rate:paid?refunded/paid:0};})};});
    const delays=cohort.flatMap(o=>{const match=incoming.filter(m=>m.orderIds.includes(o.id)&&stamp(m.at)>=stamp(o.placedAt||o.date)).sort((a,b)=>stamp(a.at)-stamp(b.at))[0];return match?[{order:o.id,shop:o.shop,hours:(stamp(match.at)-stamp(o.placedAt||o.date))/3600000}]:[];});
    const buckets=[{label:'24 小时内',min:0,max:24},{label:'1–3 天',min:24,max:72},{label:'3–7 天',min:72,max:168},{label:'7 天及以上',min:168,max:Infinity}].map(b=>({...b,count:delays.filter(d=>d.hours>=b.min&&d.hours<b.max).length}));
    const reasons=[...new Set(cohort.filter(o=>o.dissatisfaction&&o.dissatisfaction!=='无不满记录').map(o=>o.dissatisfaction))].map(reason=>({reason,count:cohort.filter(o=>o.dissatisfaction===reason).length}));
    return {incoming:scoped.length,replied:replied.length,unreplied:scoped.length-replied.length,average:replied.length?replied.reduce((n,t)=>n+t.minutes,0)/replied.length:null,agents:agentRows,stores:storeRows,delays,buckets,reasons,orders:cohort.length,noContact:cohort.length-delays.length};
  }
  const api={refundByPercent,analyze};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MailMetrics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
