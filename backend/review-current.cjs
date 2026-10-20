'use strict';
// One-time assistant review of the current local snapshot, not an automatic classifier.
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const db=new DatabaseSync('.maildesk/maildesk.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS classification_reviews(message_id TEXT PRIMARY KEY REFERENCES messages(id),category TEXT NOT NULL,subcategory TEXT NOT NULL,reason TEXT NOT NULL,content_hash TEXT NOT NULL,reviewed_at TEXT NOT NULL);`);
const groups=[
 ['售后','退货','顾客要求退回商品或咨询退货步骤',[1,2,11,19,20,21,22,26,27,46,129,142,144,147,152,170,174,180,209,250]],
 ['售后','物流查询','顾客询问已下单商品的发货时间、运输进度或物流单号',[3,4,6,8,15,18,23,25,29,30,36,37,38,40,47,48,49,50,106,127,137,145,148,154,163,167,177,178,184,188,189,192,207,212,216,224,236,238,243]],
 ['售后','未收到货','顾客明确表示未收到包裹或签收状态与实际不符',[5,7,10,16,32,34,42,43,44,45,121,136,176,190,191,208,213,237,244,248]],
 ['售后','修改商品或尺码','已下单后要求更改商品或尺码，区别于售前尺码咨询',[9,17,146,205,217,228,229,232,233]],
 ['售后','修改地址','修改或补充收货地址、邮编或联系方式',[28,33,112,113,114,115,118,122,130,131,187,193,197,198,223,235,245,246]],
 ['售后','取消订单','顾客要求取消整单或其中商品',[39,116,124,128,173,175,181,199,203,218,242,247]],
 ['售后','退款','顾客要求退款、接受补偿方案或询问退款到账',[24,31,123,132,135,179,182,210,214,231]],
 ['售后','扣款与订单确认','顾客已付款但订单号、确认邮件或订单状态需要核实',[35,103,125,126,139,140,141,156,161,165,169,202,206,220,222]],
 ['售后','错发漏发','顾客表示收到尺码与所订不一致',[171]],
 ['售后','破损与质量','顾客描述实物质量或印花与展示不符',[151]],
 ['售后','退货','商品质量及印花问题，主要请求退回全部商品',[164]],
 ['售后','投诉','顾客反馈购买体验、尺码展示与定价方面的不满',[138]],
 ['售后','回复确认','顾客对前述处理进行简短确认，保留原处理状态不自动结单',[41,185]],
 ['售前','配送范围','询问是否可寄往目标国家及相关配送费用或时效',[12,117,143,149,150,157,168,172,183,194,195,196,211,215,225,226,227,234,241,249]],
 ['售前','支付与下单','尚未完成购买，询问支付卡或当地支付限制',[159,200,221]],
 ['售前','尺码咨询','购买前咨询尺码表、上下装尺码搭配或身体尺寸',[133,160,230]],
 ['售前','商品咨询','咨询商品组成、材质、实拍或实体试穿信息',[119,120,134,155,162]],
 ['售前','批发采购','询问批发合作、起订量与批发价格',[240]],
 ['待确认','支付争议通知','平台支付争议提醒，需要业务人员处理，不视为垃圾邮件',[13,14,166,201]],
 ['待确认','系统通知','邮箱服务的欢迎、登录、授权或域名验证通知',[101,102,104,107,109,111,186]],
 ['待确认','内部测试','本次项目中用户自己的测试往来',[105,108,110]],
 ['待确认','其他业务','赞助合作或客服身份询问，不直接认定为垃圾邮件',[153,158,219]],
 ['待确认','意图不明','正文为空或信息不足，不能据此确定请求',[204,239]]
];
const seen=new Set();db.exec('BEGIN IMMEDIATE');try{for(const [category,subcategory,reason,ids] of groups)for(const n of ids){if(seen.has(n))throw Error('DUPLICATE_REVIEW');seen.add(n);const m=db.prepare("SELECT * FROM messages WHERE rowid=? AND direction='inbound'").get(n);if(!m)throw Error('SNAPSHOT_MISMATCH_'+n);const hash=createHash('sha256').update(m.subject+'\0'+m.body_text).digest('hex');db.prepare('UPDATE messages SET category=?,subcategory=? WHERE id=?').run(category,subcategory,m.id);db.prepare('INSERT OR REPLACE INTO classification_reviews VALUES(?,?,?,?,?,?)').run(m.id,category,subcategory,reason,hash,new Date().toISOString());}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
console.log(JSON.stringify({reviewed:seen.size,counts:db.prepare("SELECT category,count(*) n FROM messages WHERE id IN(SELECT message_id FROM classification_reviews) GROUP BY category").all(),unreviewed:db.prepare("SELECT rowid n,subject FROM messages WHERE direction='inbound' AND id NOT IN(SELECT message_id FROM classification_reviews)").all()}));db.close();
