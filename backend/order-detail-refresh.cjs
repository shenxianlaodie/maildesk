'use strict';
const {normalizeLegacy}=require('./legacy-order-map.cjs');
async function fetchOrderDetail(readToken,order,{fetchImpl=fetch}={}){
 const domain=String(order.shop_domain||'').toLowerCase(),id=String(order.provider_id||'');
 if(!/^[a-z0-9][a-z0-9-]*\.myshoplaza\.com$/.test(domain)||!/^\d{5,}-[A-Za-z0-9][A-Za-z0-9_-]{2,}$/.test(id))throw Error('ORDER_REFRESH_INVALID_ID');
 const sub=domain.replace(/\.myshoplaza\.com$/,'');const token=await readToken(domain);
 if(!token)throw Error('ORDER_REFRESH_NO_TOKEN');
 let response;try{response=await fetchImpl('https://'+domain+'/openapi/2025-06/orders/'+encodeURIComponent(id),{headers:{'Access-Token':token,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('ORDER_REFRESH_UNAVAILABLE');}
 if(!response.ok)throw Error(response.status===401||response.status===403?'ORDER_REFRESH_TOKEN_REJECTED':'ORDER_REFRESH_UNAVAILABLE');
 let body;try{body=await response.json();}catch{throw Error('ORDER_REFRESH_INVALID_RESPONSE');}
 const raw=body.order||body.data?.order||body.data||body;
 if(!raw||String(raw.id)!==id)throw Error('ORDER_REFRESH_ID_MISMATCH');
 const o=normalizeLegacy({store_subdomain:sub,order_id:id,order_number_full:raw.order_number||raw.number||order.order_number,customer_email_primary:raw.email||order.customer_email,created_at:raw.created_at,updated_at:raw.updated_at,indexed_at:new Date().toISOString(),payload_json:JSON.stringify(raw)},true);
 o.refreshed_at=new Date().toISOString();return o;
}
module.exports={fetchOrderDetail};
