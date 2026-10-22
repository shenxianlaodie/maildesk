'use strict';
const {createHash}=require('node:crypto');
function staffId(identity){if(identity?.auth==='password'&&typeof identity.username==='string')return 'password-'+createHash('sha256').update(identity.username.toLowerCase()).digest('hex');if(identity?.corpId&&identity?.unionId)return 'dingtalk-'+createHash('sha256').update(JSON.stringify([identity.corpId,identity.unionId])).digest('hex');return null;}
module.exports={staffId};
