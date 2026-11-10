'use strict';
// Local-only preview: no PG connection, SMTP transport, credentials or real writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createCustomerAddressHandler}=require('../backend/customer-address-http.cjs');
const address={first_name:'Alex',last_name:'Taylor',phone:'2025550100',phone_area_code:'+1',address:'12 Oak Street',address1:'',city:'Boston',province:'Massachusetts',province_code:'MA',zip:'02108',country:'United States',country_code:'US'};
const service={lookup:async i=>{if(i.order!=='TEST-001'||i.email!=='preview@example.com')throw Error('ORDER_LOOKUP_FAILED');return{token:'preview'};},read:async()=>({address,eligibility:{allowed:true}}),submit:async()=>({id:'preview',status:'pending'}),status:async()=>({id:'preview',status:'succeeded'})};
const handle=createCustomerAddressHandler({publicOrigin:'https://preview.example',frameOrigins:[],service});
http.createServer(async(req,res)=>{
 if(req.url==='/preview-order'){
  const snippet=fs.readFileSync(path.join(__dirname,'../storefront/customer-address.liquid'),'utf8').replace(/\{%[\s\S]*?%\}/g,'').replace(/Include only[^\n]*/,'').replace('{{ address_order_number | escape }}','TEST-001').replace('{{ order.customer.email | escape }}','preview@example.com').replaceAll('https://chat.thinkpro.top/maildesk','http://127.0.0.1:19988');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order details — local preview</title><h1>Order TEST-001</h1><p>Local preview: simulated order and address. No real updates or emails.</p>'+snippet);return;
 }
 req.headers.host='preview.example';if(req.headers.origin)req.headers.origin='https://preview.example';
 const setHeader=res.setHeader.bind(res);res.setHeader=(k,v)=>setHeader(k,k==='Content-Security-Policy'?v.replace("frame-ancestors 'none'","frame-ancestors 'self'"):v);
 if(!await handle(req,res)){res.writeHead(404);res.end();}
}).listen(19988,'127.0.0.1',()=>console.log('Local mock only: http://127.0.0.1:19988/preview-order'));
