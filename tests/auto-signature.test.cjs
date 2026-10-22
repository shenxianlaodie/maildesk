const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../backend/database.cjs'),{createDingtalk}=require('../backend/dingtalk.cjs'),{readSignatures,assignUnusedSignature}=require('../backend/signatures.cjs');
test('only new logins randomly claim unused codes, persist without duplicates, and pool exhaustion permits login',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auto-signature-')),filename=path.join(dir,'users.json'),store=new Store(':memory:');t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 fs.writeFileSync(filename,JSON.stringify([{corpId:'corp',unionId:'old',name:'Old',role:'staff'}]));let unionId='old';
 const options={clientId:'client',clientSecret:'secret',corpId:'corp',redirectUri:'https://example.com/callback',filename,fetchImpl:async url=>({ok:true,json:async()=>url.includes('userAccessToken')?{corpId:'corp',accessToken:'token'}:{unionId,nick:unionId}})};
 let auth=createDingtalk(options);auth.connectStaff(store);
 async function login(id){unionId=id;const a=auth.start();return auth.finish(new URLSearchParams({state:new URL(a.url).searchParams.get('state'),authCode:'code'}),a.browser);}
 await login('old');assert.ok(readSignatures(store.db).every(r=>!r.staffId));
 for(const id of ['a','b','c'])await login(id);
 const rows=readSignatures(store.db);assert.equal(rows.filter(r=>r.staffId).length,3);assert.equal(new Set(rows.map(r=>r.staffId)).size,3);
 const snapshot=JSON.stringify(rows);await login('overflow');assert.equal(JSON.stringify(readSignatures(store.db)),snapshot);
 const first=rows[0];assert.equal(assignUnusedSignature(store,first.staffId),first.code);
 auth=createDingtalk(options);auth.connectStaff(store);await login('old');assert.equal(JSON.stringify(readSignatures(store.db)),snapshot);
 assert.equal((await login('overflow')).role,'staff');
});
