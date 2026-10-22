'use strict';
const fs=require('node:fs'),path=require('node:path');
function loadEnvironment(){const filename=path.resolve(__dirname,'../.env');if(fs.existsSync(filename))process.loadEnvFile(filename);}
function dataDirectory(demo){return demo?path.resolve(__dirname,'../.demo-data'):path.resolve(process.env.MAILDESK_DATA_DIR||path.resolve(__dirname,'../.preview-data'));}
module.exports={loadEnvironment,dataDirectory};
