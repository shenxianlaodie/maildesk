'use strict';
const fs=require('node:fs'),path=require('node:path'),{isIP}=require('node:net');
function createCustomerAddressHandler({publicOrigin,basePath='',frameOrigins=[],trustedProxyAddresses=[],service}){
 const origin=new URL(publicOrigin);if(origin.origin!==publicOrigin||origin.protocol!=='https:')throw Error('INVALID_PUBLIC_ORIGIN');
 if(frameOrigins.some(v=>{try{return new URL(v).origin!==v||!v.startsWith('https://');}catch{return true;}}))throw Error('INVALID_FRAME_ORIGIN');
 if(!Array.isArray(trustedProxyAddresses)||trustedProxyAddresses.some(v=>!isIP(v)))throw Error('INVALID_TRUSTED_PROXY');
 const prefix=basePath+'/customer-address/';
 const assets={'':'index.html','app.js':'app.js','form-model.js':'form-model.js','style.css':'style.css'};
 const safeErrors=new Set(['ORDER_LOOKUP_FAILED','RATE_LIMITED','VERIFICATION_REQUIRED','READ_ADDRESS_FIRST','REQUEST_ALREADY_SUBMITTED','INVALID_ADDRESS','COUNTRY_CHANGE_UNAVAILABLE','ORDER_NOT_EDITABLE','ORDER_ADDRESS_WINDOW_EXPIRED','ORDER_ADDRESS_TIME_UNKNOWN','REQUEST_NOT_FOUND','active_address_request_exists','invalid_address_field','invalid_address_payload','idempotency_key_reused']);
 return async function handle(req,res){
  if(!String(req.url).startsWith(prefix))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors ${frameOrigins.join(' ')||"'none'"}`);
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==origin.host){send(403,{error:'ORIGIN_REQUIRED'});return true;}
   const name=req.url.slice(prefix.length).split('?')[0];
   if(req.method==='GET'&&Object.hasOwn(assets,name)){const file=assets[name];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'public/customer-address',file)));return true;}
   if(req.method!=='POST'||!['api/lookup','api/read','api/submit','api/status'].includes(name)){send(404,{error:'NOT_FOUND'});return true;}
   if(req.headers.origin!==publicOrigin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){send(403,{error:'ORIGIN_REQUIRED'});return true;}
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>20000){send(413,{error:'BODY_TOO_LARGE'});return true;}chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'INVALID_JSON'});return true;}if(!input||typeof input!=='object'||Array.isArray(input)){send(400,{error:'INVALID_JSON'});return true;}
   // Only a configured, directly connected proxy may supply the rightmost appended client address.
   const remote=String(req.socket.remoteAddress||'unknown').replace(/^::ffff:/,''),forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
   const ip=trustedProxyAddresses.includes(remote)&&isIP(forwarded)?forwarded:remote,token=String(req.headers.authorization||'').replace(/^Bearer /,'');let result;
   switch(name){case'api/lookup':result=await service.lookup(input,ip);break;case'api/read':result=await service.read(token);break;case'api/submit':result=await service.submit(token,input);break;case'api/status':result=await service.status(token,input.id);break;}
   send(200,result);
  }catch(e){const error=safeErrors.has(e.message)?e.message:'SERVICE_UNAVAILABLE';send(error==='RATE_LIMITED'?429:error==='VERIFICATION_REQUIRED'?401:error==='SERVICE_UNAVAILABLE'?503:400,{error,editRejected:require('./customer-address.cjs').definiteErrors.has(e.message)});}
  return true;
 };
}
function loadCustomerAddress({directory,store,publicOrigin,basePath=''}){
 const filename=path.join(directory,'customer-address.json');if(!fs.existsSync(filename))return null;const config=JSON.parse(fs.readFileSync(filename,'utf8'));if(config.enabled!==true)return null;
 if(!config.stores||!Object.keys(config.stores).length)throw Error('CUSTOMER_ADDRESS_CONFIG_REQUIRED');
 for(const [key,s]of Object.entries(config.stores)){
  if(!/^[a-z0-9-]{1,60}$/.test(key)||!/^[a-z0-9][a-z0-9-]*$/.test(s.subdomain)||!Array.isArray(s.origins)||!s.origins.length)throw Error('CUSTOMER_ADDRESS_CONFIG_REQUIRED');

 }
 const queue=require('./order-address-queue.cjs').createAddressQueue(JSON.parse(fs.readFileSync(path.join(directory,'order-address-writer-credentials.json'),'utf8')));
 const service=require('./customer-address.cjs').createCustomerAddress({db:store.db,queue,stores:config.stores});
 return {handle:createCustomerAddressHandler({publicOrigin,basePath,frameOrigins:[...new Set(Object.values(config.stores).flatMap(s=>s.origins))],trustedProxyAddresses:config.trustedProxyAddresses||[],service}),close:()=>queue.close()};
}
module.exports={createCustomerAddressHandler,loadCustomerAddress};
