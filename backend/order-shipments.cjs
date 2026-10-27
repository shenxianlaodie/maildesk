'use strict';
function orderShipments(fulfillments){
 const records=new Map();
 function add(value,parent,historical,current){const item=typeof value==='string'?{tracking_number:value}:value;if(!item?.tracking_number)return;const number=String(item.tracking_number).trim();if(!number)return;const key=number.toUpperCase(),previous=records.get(key);
  if(previous&&!previous.historical&&historical)return;
  records.set(key,{tracking_number:number,carrier:item.tracking_company||parent.tracking_company||previous?.carrier||null,historical,...(historical?{currentTrackingNumber:current}:{} )});
 }
 for(const f of Array.isArray(fulfillments)?fulfillments:[]){if(!f||typeof f!=='object')continue;
  for(const item of [f,...(Array.isArray(f.tracking_items)?f.tracking_items:[])]){add(item,f,false);for(const old of Array.isArray(item?.tracking_number_history)?item.tracking_number_history:[])add(old,item,true,item.tracking_number||f.tracking_number);}
 }
 return [...records.values()].sort((a,b)=>Number(a.historical)-Number(b.historical));
}
module.exports={orderShipments};
