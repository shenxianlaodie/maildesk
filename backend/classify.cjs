'use strict';
// Conservative local rules, not an AI service. Quoted history is excluded.
function classify(subject,body){const current=String(body||'').split(/\n(?:On .{0,180}wrote:|Le .{0,180}écrit|>)/i)[0];const text=(subject+'\n'+current).toLowerCase();const result=(category,subcategory)=>({category,subcategory});
 if(/shoplazza payments.*争议/.test(subject))return result('待确认','支付争议通知');
 if(/new login activity|新的登录|domain verified|邮箱授权/.test(text))return result('待确认','系统通知');
 const rules=[['售后','取消订单',/\b(cancel|cancellation)\b.{0,35}\border|取消订单|annuler.{0,20}commande/],['售后','修改地址',/\b(change|wrong|incorrect|update|old)\b.{0,30}\b(address|adress)\b|address change|修改地址|adressänderung/],['售后','修改商品或尺码',/\b(change|wrong|mistake)\b.{0,45}\bsize\b|修改尺码/],['售后','退货',/\b(return|retour|rückgabe|retournieren|devolución|reso)\b|退货/],['售后','退款',/\brefund|reembolso|退款/],['售后','未收到货',/not (received|delivered)|never (received|arrived)|haven.t received|未收到|pas reçu/],['售后','扣款与订单确认',/no.{0,20}confirmation|never.{0,25}(order number|confirmation)|charged twice|扣款/],['售后','物流查询',/tracking|where.{0,25}(order|package)|status of my|when.{0,25}(arrive|ship)|物流|sendungsverfolgung/],['售前','配送范围',/(do you|can you|possible to).{0,25}(deliver|ship)|достав.{0,35}(росси|беларус)|配送范围/],['售前','尺码咨询',/size chart|what size|measurements|尺码表/],['售前','批发采购',/wholesale|批发/]];
 for(const [a,b,re] of rules)if(re.test(text))return result(a,b);return result('待确认','意图不明');}
module.exports={classify};
