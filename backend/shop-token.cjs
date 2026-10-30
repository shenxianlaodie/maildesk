'use strict';
const {createDecipheriv}=require('node:crypto');
function decryptShopToken(value,keyHex){
 if(!/^[0-9a-f]{64}$/i.test(keyHex||''))throw Error('ORDER_TOKEN_KEY_INVALID');
 const parts=typeof value==='string'&&/^([0-9a-f]{32}):([0-9a-f]{32}):((?:[0-9a-f]{2})+)$/i.exec(value);
 if(!parts)throw Error('ORDER_TOKEN_FORMAT_INVALID');
 try{const decipher=createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),Buffer.from(parts[1],'hex'));decipher.setAuthTag(Buffer.from(parts[2],'hex'));const token=Buffer.concat([decipher.update(Buffer.from(parts[3],'hex')),decipher.final()]).toString('utf8');if(!token.trim())throw Error();return token;}catch{throw Error('ORDER_TOKEN_DECRYPT_FAILED');}
}
function createShopTokenReader(database,key=()=>process.env.ORDER_TOKEN_DECRYPT_KEY_HEX,{fallback,timeoutMs=1500,clock=Date.now}={}){
 let retryAt=0;
 return async value=>{
  let domain=String(value||'').trim().toLowerCase();if(!domain.includes('.'))domain+='.myshoplaza.com';
  if(!/^[a-z0-9][a-z0-9-]*\.myshoplaza\.com$/.test(domain))throw Error('ORDER_TOKEN_INVALID_DOMAIN');
  const local=async()=>{if(fallback){const token=await fallback(domain);if(token)return token;}throw Error('ORDER_TOKEN_DATABASE_UNAVAILABLE');};
  if(clock()<retryAt)return local();
  let rows,timer;try{rows=await Promise.race([database.read("SELECT access_token,enabled FROM public.support_stores WHERE CASE WHEN position('.' in btrim(subdomain))>0 THEN lower(btrim(subdomain)) ELSE lower(btrim(subdomain))||'.myshoplaza.com' END=$1 LIMIT 2",[domain]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ORDER_TOKEN_DATABASE_UNAVAILABLE')),timeoutMs);})]);}catch{retryAt=clock()+15000;return local();}finally{clearTimeout(timer);}
  if(!rows.length)throw Error('ORDER_REFRESH_NO_TOKEN');
  if(rows.length!==1)throw Error('ORDER_TOKEN_STORE_AMBIGUOUS');
  if(rows[0].enabled!==true)throw Error('ORDER_TOKEN_STORE_DISABLED');
  if(!rows[0].access_token)throw Error('ORDER_REFRESH_NO_TOKEN');
  return decryptShopToken(rows[0].access_token,key());
 };
}
module.exports={decryptShopToken,createShopTokenReader};
