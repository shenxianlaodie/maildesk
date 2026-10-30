'use strict';
// Local credentials remain in the existing encrypted vault; never copy them into order data.
function readLocalShopToken(directory,domain){
 if(!/^[a-z0-9][a-z0-9-]*\.myshoplaza\.com$/.test(domain))throw Error('ORDER_TOKEN_INVALID_DOMAIN');
 const path=require('node:path'),fs=require('node:fs'),{DatabaseSync}=require('node:sqlite'),{Vault}=require('./vault.cjs');
 const file=path.join(directory,'maildesk.sqlite'),credentials=path.join(directory,'credentials.dpapi');
 if(!fs.existsSync(file)||!fs.existsSync(credentials))return null;
 const db=new DatabaseSync(file,{readOnly:true});try{
  const shops=db.prepare('SELECT id FROM shops WHERE lower(domain)=?').all(domain);if(shops.length!==1)return null;
  // enabled:shoplazza controls the old bulk sync scheduler, not use of its configured token for an individual order read.
  return new Vault(credentials).get(shops[0].id==='example-shop'?'shoplazza':'shoplazza:'+shops[0].id).token||null;
 }finally{db.close();}
}
module.exports={readLocalShopToken};
