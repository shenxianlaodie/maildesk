'use strict';
require('./environment.cjs').loadEnvironment();
const {createOrderDatabase}=require('../backend/order-database.cjs');
(async()=>{let database;try{database=createOrderDatabase(process.env.ORDER_DATABASE_URL);console.log(JSON.stringify(await database.inspect(),null,2));}
catch(err){const code=String(err.code||err.message||'CONNECTION_FAILED');console.error('订单数据库检查失败：'+(/^[A-Z0-9_]+$/.test(code)?code:'CONNECTION_FAILED'));if(code==='28000')console.error('请检查 PostgreSQL pg_hba.conf、数据库用户权限与访问 IP 白名单。');process.exitCode=1;}
finally{if(database)await database.close();}})();
