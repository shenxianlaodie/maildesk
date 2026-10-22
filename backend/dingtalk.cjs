'use strict';
const fs=require('node:fs');
const {randomBytes,createHash}=require('node:crypto');
function createDingtalk({clientId,clientSecret,corpId,redirectUri,filename,fetchImpl=fetch,clock=Date.now}){
 if(![clientId,clientSecret,corpId,redirectUri,filename].every(Boolean))throw Error('DINGTALK_CONFIG_INCOMPLETE');
 const pending=new Map();
 let staffStore=null;
 function syncStaff(user,isNew=false){if(!staffStore||user.corpId!==corpId)return;const id="dingtalk-"+createHash("sha256").update(JSON.stringify([user.corpId,user.unionId])).digest("hex");staffStore.addStaff({id,name:String(user.name||"钉钉用户").trim()||"钉钉用户"});if(isNew)require("./signatures.cjs").assignUnusedSignature(staffStore,id);}
 const users=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):[];
 function save(){const temp=filename+'.tmp';fs.writeFileSync(temp,JSON.stringify(users,null,2),{mode:0o600});fs.renameSync(temp,filename);}
 async function request(url,options){const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('DINGTALK_API_FAILED');return response.json();}
 return {
  redirectUri,
  connectStaff(store){staffStore=store;store.transaction(()=>{for(const user of users)syncStaff(user);});},
  start(){for(const [key,value] of pending)if(value.expires<=clock())pending.delete(key);if(pending.size>=500)throw Error('DINGTALK_BUSY');const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex');pending.set(state,{browser,expires:clock()+300000});const url=new URL('https://login.dingtalk.com/oauth2/auth');url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,state,response_type:'code',scope:'openid corpid',prompt:'consent'});return{url:url.href,browser};},
  async finish(params,browser){const state=params.get('state'),entry=pending.get(state);pending.delete(state);if(!entry||entry.expires<=clock()||!browser||entry.browser!==browser)throw Error('DINGTALK_STATE_INVALID');const code=params.get('authCode');if(params.has('error')||!code||code.length>4096)throw Error('DINGTALK_AUTH_CANCELLED');const token=await request('https://api.dingtalk.com/v1.0/oauth2/userAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,clientSecret,code,grantType:'authorization_code'})});if(token.corpId!==corpId)throw Error('DINGTALK_CORP_DENIED');if(!token.accessToken)throw Error('DINGTALK_API_FAILED');const profile=await request('https://api.dingtalk.com/v1.0/contact/users/me',{headers:{'x-acs-dingtalk-access-token':token.accessToken}});if(typeof profile.unionId!=='string'||!profile.unionId)throw Error('DINGTALK_IDENTITY_MISSING');let user=users.find(u=>u.unionId===profile.unionId&&u.corpId===corpId);const isNew=!user;if(!user){user={unionId:profile.unionId,corpId,role:'staff',createdAt:new Date(clock()).toISOString()};users.push(user);}user.name=String(profile.nick||'钉钉用户').slice(0,120);user.lastLoginAt=new Date(clock()).toISOString();save();syncStaff(user,isNew);return {...user};},
  getUser(identity){if(!identity||identity.corpId!==corpId)return null;const user=users.find(u=>u.unionId===identity.unionId&&u.corpId===corpId);return user?{...user}:null;},
 };
}
module.exports={createDingtalk};
