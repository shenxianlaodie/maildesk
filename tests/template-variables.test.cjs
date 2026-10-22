'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function templateTrackingDetails('),source.indexOf('function insertTemplate(')),context);
test('template variables follow selected order, preserve literal text and include all shipment numbers',()=>{
 const values=context.templateValues({customer:{display_name:'$& Alice',email:'alice@example.com'}},{order_number:'ORDER2',shop_name:'Shop',shipments:[{tracking_number:'AB123',carrier:'Carrier'},{tracking_number:'CD456',carrier:'Carrier'}],tracking:[{at:'2026-10-21',status:'In transit',location:'Hub'}]});
 const result=context.fillTemplate('Dear {name}: {order} / {tracking_number} / {carrier}\n{tracking_url}\n{tracking_info}',values);
 assert.equal(result.missing.length,0);assert.match(result.text,/Dear \$& Alice: ORDER2/);assert.match(result.text,/AB123, CD456/);assert.match(result.text,/https:\/\/t.17track.net\/en#nums=CD456/);assert.match(result.text,/2026-10-21 · In transit · Hub/);
});
test('missing order or actual tracking events blocks insertion instead of inventing logistics',()=>{
 const values=context.templateValues({customer:{email:'alice@example.com'}},null);const result=context.fillTemplate('{order} {tracking_number} {tracking_info} {unknown}',values);assert.equal(result.missing.join(','),'order,tracking_number,tracking_info,unknown');
 const known=context.templateValues({customer:{}},{shipments:[{tracking_number:'AB123'}],tracking:[]});assert.equal(context.fillTemplate('{tracking_url}',known).missing.length,0);assert.equal(context.fillTemplate('{tracking_info}',known).missing[0],'tracking_info');
});

test('tracking_info uses exact Copy Details for current shipments, excludes stale and partial captures',()=>{
 const details='Number: AB123\nDelivered\n2026-10-20 14:35 Front door',o={shipments:[{tracking_number:'AB123'}],tracking:[],trackingCaptures:[{number:'AB123',copy_details:details,captured_at:new Date().toISOString(),status:'unknown'}]};
 assert.equal(context.templateValues({customer:{}},o).tracking_info,details);
 o.trackingCaptures[0].captured_at='2000-01-01';assert.equal(context.templateValues({customer:{}},o).tracking_info,'');
 o.trackingCaptures[0].captured_at=new Date().toISOString();o.shipments.push({tracking_number:'CD456'});assert.equal(context.templateValues({customer:{}},o).tracking_info,'');
 o.trackingCaptures.push({number:'CD456',copy_details:'Number: CD456\nIn transit',captured_at:new Date().toISOString()});assert.match(context.templateValues({customer:{}},o).tracking_info,/CD456/);
});
