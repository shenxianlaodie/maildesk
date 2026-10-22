'use strict';
// Mirrors the supplied storefront schedule, kept separate from carrier events.
const steps=[{"label": "Payment Successful", "desc": "Your order has been successfully placed.", "min": 0, "max": 0}, {"label": "Order Confirmed", "desc": "Your order has been confirmed and is being prepared by the warehouse.", "min": 710, "max": 730}, {"label": "Items Processing", "desc": "Your items are being prepared and checked for size, color, and style.", "min": 1430, "max": 1450}, {"label": "Quality Inspection", "desc": "Your items are undergoing final quality inspection before shipment.", "min": 4310, "max": 4330}, {"label": "Packaging", "desc": "Your items have passed quality inspection and are being carefully packed.", "min": 5750, "max": 5770}, {"label": "Awaiting Carrier Pickup", "desc": "Your package has been packed and is waiting for the carrier to pick it up.", "min": 8630, "max": 8650}, {"label": "Shipped", "desc": "Your package has been handed over to the carrier. Tracking information will be updated soon.", "min": 14390, "max": 14410}];
const normalize=v=>String(v||'').trim().toLowerCase();
function hashCode(value){let hash=0;const text=String(value||'');for(let i=0;i<text.length;i++){hash=((hash<<5)-hash)+text.charCodeAt(i);hash|=0;}return Math.abs(hash);}
function random(seed){const n=Math.sin(seed)*10000;return n-Math.floor(n);}
function virtualProgress(row,now=Date.now()){
 const financial=Object.hasOwn(row,'progress_financial_status')?row.progress_financial_status:row.payment_status;
 const fulfillment=Object.hasOwn(row,'progress_fulfillment_status')?row.progress_fulfillment_status:row.fulfillment_status;
 if(normalize(financial)!=='paid'||!['','initialled','waiting'].includes(normalize(fulfillment)))return null;
 const base=[row.placed_at,row.ordered_at,row.progress_placed_at,row.progress_created_at].map(value=>typeof value==='string'&&value?new Date(value):null).find(d=>d&&Number.isFinite(d.getTime())&&d.getFullYear()>=2000);
 const result={source:'storefront-rule',simulated:true,baseTime:base?.toISOString()||null,events:[]};
 if(!base){result.events.push({label:steps[0].label,desc:steps[0].desc,at:null});return result;}
 const id=Object.hasOwn(row,'progress_order_id')?row.progress_order_id:row.order_id;
 for(let i=0;i<steps.length;i++){
  const {label,desc,min,max}=steps[i],seed=hashCode(id)+i+7;
  const at=base.getTime()+(min+Math.floor(random(seed)*(max-min+1)))*60000+Math.floor(random(seed+999)*60)*1000;
  if(now<at)break;
  result.events.push({label,desc,at:new Date(at).toISOString()});
 }
 result.events.reverse();return result;
}
module.exports={virtualProgress};
