'use strict';
const {classifyAI}=require('./ai.cjs');
function currentText(body){return String(body||'').replace(/\r\n/g,'\n').split(/(?:^|\n)\s*(?:>.*|On .{0,200}wrote:|Le .{0,200}écrit\s*:|Am .{0,200}schrieb|在.{0,100}写道[:：]|-{2,}\s*(?:Original Message|Forwarded message)|From:\s*.+|Best regards[,!]?\s*$|Sent from my .+|--\s*$)/im)[0].trim();}
function classifyRules(message,orders=[]){
 const subject=String(message.subject||'').trim(),body=currentText(message.body_text),text=((body&&/^(?:re|fw|fwd)\s*:/i.test(subject)?'':subject)+'\n'+body).toLowerCase().replace(/[’‘]/g,"'");
 const result=(category,subcategory=category)=>({category,subcategory,reason:'代码规则：'+category+(subcategory===category?'':' / '+subcategory),confidence:0.95,mode:'rules'});
 if(/\b(?:do not|don't|not to|no need to)\s+(?:cancel|change|refund|return|ship)|不要(?:取消|退款|修改)|\b(?:return|refund|cancellation) policy\b|退货政策|\b(?:not|isn't|aren't)\s+(?:damaged|broken|defective|wrong)|没有(?:破损|质量问题)/.test(text))return null;
 const hits=[];
 if(/\b(?:cancel|cancellation)\b.{0,35}\border\b|\b(?:change|update|correct|wrong|incorrect)\b.{0,40}\b(?:address|adress)\b|\b(?:change|update|switch)\b.{0,40}\b(?:size|colour|color|item|quantity)\b|取消订单|修改.{0,8}(?:地址|尺码|商品|数量)|地址.{0,8}(?:错了|错误)|annuler.{0,20}commande|adressänderung/.test(text))hits.push('修改订单信息');
 if(/\b(?:please|could you|can you)\s+(?:ship|dispatch|send out)\b|\b(?:ship|dispatch)\b.{0,25}\b(?:asap|as soon as possible|immediately|today)\b|\bwhen\b.{0,25}\b(?:ship|dispatch)\b|\bnot (?:yet )?(?:shipped|dispatched)\b|尽快发货|什么时候发货|催发货|还没发货/.test(text))hits.push('催发货');
 const received=/\b(?:received|arrived|delivered|got)\b.{0,65}\b(?:damaged|broken|wrong|defective|small|large|poor|different)\b|\b(?:item|product|shirt|dress|shoes)\b.{0,30}\b(?:damaged|broken|defective|doesn't fit|does not fit|not as described)\b|收到.{0,25}(?:破损|不满意|不对|太小|太大|质量)|货不对板|错发|漏发|质量问题|尺码不合适|beschädigt|defekt/.test(text);
 if(received)hits.push('收到货不满意');
 if(!received&&/\b(?:refund|return|exchange)\b|退款|退货|换货/.test(text))return null;
 if(/\bwhere\b.{0,30}\b(?:order|parcel|package|shipment)\b|\b(?:not|never|haven't|hasn't|have not|has not)\b.{0,20}\b(?:received|arrived|delivered)\b|\btracking\b.{0,30}\b(?:update|stuck|number|working|status)\b|\b(?:delivery|shipping) status\b|\bwhen\b.{0,25}\barrive\b|未收到|没收到|物流.{0,12}(?:查询|不动|异常|更新)|包裹.{0,12}(?:哪里|没到)|pas reçu|sendungsverfolgung|wo.{0,20}bestellung/.test(text))hits.push('物流异常');
 if(/\bsize chart\b|\bwhat size\b|\b(?:do you|can you)\b.{0,25}\b(?:ship to|deliver to)\b|\b(?:material|fabric)\b.{0,20}\b(?:made|cotton|polyester)\b|\bwhat\b.{0,20}\b(?:material|fabric)\b|\bwholesale\b|\bin stock\b|尺码表|购买前|什么材质|有货吗|配送范围|批发/.test(text))hits.push('售前咨询');
 const notification=/^(?:automatic reply|auto(?:matic)?[- ]reply|out of office|undeliverable|delivery status notification|mail delivery failed|failure notice)\b|new login activity|domain verified|新的登录|邮箱授权|shoplazza payments.*争议/i.test(subject)||(/^(?:mailer-daemon|postmaster)@/i.test(message.from_address||'')&&/delivery|undeliver|failure/i.test(subject));
 if(notification&&hits.length)return null;if(notification)return result('各种通知以及垃圾邮件');
 const unique=[...new Set(hits)];if(unique.length!==1)return null;
 return result(unique[0]);
}
async function classifyMessage(config,message,loadOrders=async()=>[],fetchImpl=fetch){
 const quick=classifyRules(message);if(quick)return quick;
 const orders=await loadOrders(),matched=classifyRules(message,orders);if(matched)return matched;
 if(!config.apiKey||!config.model||config.autoClassify!==true)return null;
 return{...await classifyAI(config,{...message,body_text:currentText(message.body_text)},orders,fetchImpl),mode:'ai'};
}
function classify(subject,body,orders=[]){const r=classifyRules({subject,body_text:body},orders);return r?{category:r.category,subcategory:r.subcategory}:{category:'未能正确分类',subcategory:'未能正确分类'};}
module.exports={classify,classifyRules,classifyMessage,currentText};
