'use strict';
const {idFor}=require('./database.cjs');
const {mapOrder}=require('./external-orders.cjs');
const parse=v=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return v;}};
const text=v=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
function normalizeLegacy(row,core=false){
 const domain=text(row.store_subdomain).toLowerCase().replace(/\.myshoplaza\.com$/,'')+'.myshoplaza.com';
 if(!/^[a-z0-9][a-z0-9-]*\.myshoplaza\.com$/.test(domain)||!text(row.order_id))return null;
 const raw=parse(core?row.payload_json:row.raw_summary_json),p=raw&&typeof raw==='object'&&!Array.isArray(raw)?{...raw}:{};
 if(!core)for(const [k,v]of Object.entries(row))if(v!==null&&v!==undefined&&v!=='')p[k]=parse(v);
 const customer=parse(p.customer)||{},address=parse(p.shipping_address)||{},items=parse(p.line_items);
 const emails=[row.customer_email_primary,row.customer_email,p.email,customer.email,address.email].map(v=>text(v).toLowerCase()).filter(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
 const fs=parse(p.fulfillments),fulfillments=Array.isArray(fs)?fs.filter(f=>f&&typeof f==='object'):[];
 const numbers=new Set();
 function collect(v){v=parse(v);if(Array.isArray(v)){for(const n of v)collect(n);}else if(typeof v==='string'){for(const n of v.split(/[,;\s]+/))if(/^[a-z0-9][a-z0-9-]{4,99}$/i.test(n))numbers.add(n.toUpperCase());}}
 for(const k of ['logistics_code','tracking_number','tracking_numbers','track_numbers'])collect(p[k]||row[k]);
 for(const n of numbers)fulfillments.push({tracking_number:n});
 const safeDate=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
 const r={id:row.order_id,store_subdomain:domain,store_name:domain,order_id:text(row.order_id),order_number:text(row.order_number_full||row.order_number_short||p.number||p.order_number||row.order_id),customer_email:emails[0]||'',order_status:text(p.status),fulfillment_status:text(p.fulfillment_status||row.fulfillment_status),payment_status:text(p.financial_status||row.financial_status),order_amount:p.total_price,order_currency:text(p.currency),payment_method:text(p.payment_method),total_paid:p.total_paid,subtotal:p.sub_total,total_refund_price:p.total_refund_price,shipping:p.total_shipping,items_json:Array.isArray(items)?items:[],shipping_address_json:address&&typeof address==='object'?address:{},fulfillments,placed_at:safeDate(p.placed_at),ordered_at:safeDate(row.created_at||p.created_at),updated_at:safeDate(row.updated_at||p.updated_at),fetched_at:safeDate(row.indexed_at)};
 const o=mapOrder(r);o.id='cw:'+idFor('chatwoot-order',domain+'\0'+r.order_id);o.source='chatwoot';o.shop_domain=domain;o.emails=[...new Set(emails)];
 // Only an explicit shipment timestamp may populate shipped_at; processed/updated times are not shipment events.
 o.shipped_at=o.shipped_at||safeDate(p.shipped_at)||null;
 o.shipments=[...new Map(o.shipments.map(s=>[s.tracking_number.toUpperCase(),s])).values()];
 return o;
}
module.exports={normalizeLegacy};
