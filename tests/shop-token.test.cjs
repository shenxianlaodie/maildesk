const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes,createCipheriv}=require('node:crypto');
const {decryptShopToken,createShopTokenReader}=require('../backend/shop-token.cjs');
const key=randomBytes(32),keyHex=key.toString('hex');
function encrypt(text){const iv=randomBytes(16),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return [iv,c.getAuthTag(),data].map(x=>x.toString('hex')).join(':');}
test('decrypts delivered AES-GCM format; invalid key, tampering and plaintext fail closed',()=>{
 const value=encrypt('test-access-token');assert.equal(decryptShopToken(value,keyHex),'test-access-token');
 for(const [v,k] of [[value,'bad'],[value,randomBytes(32).toString('hex')],['plain-token',keyHex],[value.slice(0,-2)+'zz',keyHex],[encrypt(''),keyHex]])assert.throws(()=>decryptShopToken(v,k),/^Error: ORDER_TOKEN_/);
});
test('reads only matching PG store and reloads rotated tokens without caching',async()=>{
 let token='first',calls=0;const reader=createShopTokenReader({read:async(sql,args)=>{calls++;assert.match(sql,/public\.support_stores/);assert.deepEqual(args,['shop.myshoplaza.com']);return [{access_token:encrypt(token),enabled:true}];}},()=>keyHex);
 assert.equal(await reader(' SHOP.myshoplaza.com '),'first');token='second';assert.equal(await reader('shop'),'second');assert.equal(calls,2);
});
test('missing, disabled, duplicate, broken ciphertext and database errors never return fallback credentials',async()=>{
 for(const [rows,error] of [[[],'NO_TOKEN'],[[{enabled:false,access_token:encrypt('test')}],'DISABLED'],[[{},{}],'AMBIGUOUS'],[[{enabled:true,access_token:'broken'}],'FORMAT']])await assert.rejects(createShopTokenReader({read:async()=>rows},()=>keyHex)('shop'),new RegExp(error));
 await assert.rejects(createShopTokenReader({read:async()=>{throw Error('sensitive connection details');}},()=>keyHex)('shop'),/^Error: ORDER_TOKEN_DATABASE_UNAVAILABLE$/);
 await assert.rejects(createShopTokenReader({read:async()=>{throw Error('must not query');}},()=>keyHex)('evil.example'),/INVALID_DOMAIN/);
});
