'use strict';
const path=require('node:path');
const {loadEnvironment,dataDirectory}=require('./environment.cjs');loadEnvironment();
const {createPilot}=require('../backend/pilot.cjs');
const {createLanProxy}=require('../backend/lan/proxy.cjs');
const directory=dataDirectory(false),publicOrigin=process.env.MAILDESK_PUBLIC_ORIGIN;
if(!publicOrigin)throw Error('PUBLIC_ORIGIN_REQUIRED');
const {createDingtalk}=require('../backend/dingtalk.cjs');
const dingtalk=createDingtalk({clientId:process.env.DINGTALK_APP_KEY,clientSecret:process.env.DINGTALK_APP_SECRET,corpId:process.env.DINGTALK_CORP_ID,redirectUri:process.env.DINGTALK_REDIRECT_URI,filename:path.join(directory,'dingtalk-users.json')});
const app=createPilot({directory,port:4175,host:process.env.MAILDESK_HOST||'127.0.0.1',autoSync:false,demo:false,orderDatabaseUrl:process.env.ORDER_DATABASE_URL});
dingtalk?.connectStaff(app.store);
const passwordUsers=require('../backend/password-users.cjs').createPasswordUsers(path.join(directory,'password-users.json'));passwordUsers.connectStaff(app.store);
const gateway=createLanProxy({address:'0.0.0.0',port:4182,upstreamPort:4175,kind:'business',adminUpstreamPort:4175,sessionMs:7*24*3600000,sessionFile:path.join(directory,'login-sessions.json'),auditFile:path.join(directory,'operation-log.sqlite'),dingtalk,passwordUsers,publicOrigin,basePath:process.env.MAILDESK_BASE_PATH||''});
(async()=>{try{await app.listen();await gateway.listen();console.log('Maildesk ready. Authenticated login required; settings restricted to administrators.');}catch{console.error('SERVER_START_FAILED');process.exit(1);}})();
let stopping=false;async function close(){if(stopping)return;stopping=true;await gateway.close();await app.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
