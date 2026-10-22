'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../backend/public/desk/app.js'),'utf8');
test('inline tracking waits for visibility, cancels rapid navigation and starts only once',()=>{
 let callback,disconnected=false;const pending=new Map(),started=[];let id=0;const node={dataset:{},isConnected:true};
 const context=vm.createContext({$$:selector=>selector==='[data-inline-tracking]'?[node]:[],setTimeout:fn=>{pending.set(++id,fn);return id;},clearTimeout:id=>pending.delete(id),IntersectionObserver:class{constructor(cb){callback=cb;}observe(){}disconnect(){disconnected=true;}}});
 vm.runInContext(source.slice(source.indexOf('let trackingObserver='),source.indexOf('async function loadInlineTracking('))+'\nfunction loadInlineTracking(node){started.push(node);}',Object.assign(context,{started}));
 context.observeTracking();assert.equal(pending.size,0);callback([{target:node,isIntersecting:true}]);assert.equal(pending.size,1);callback([{target:node,isIntersecting:false}]);assert.equal(pending.size,0);callback([{target:node,isIntersecting:true}]);context.stopTrackingObservers();assert.equal(pending.size,0);assert.equal(disconnected,true);
 context.observeTracking();callback([{target:node,isIntersecting:true}]);const fn=[...pending.values()][0];pending.clear();fn();assert.equal(started.length,1);callback([{target:node,isIntersecting:true}]);assert.equal(pending.size,0);
});
test('virtual progress follows storefront eligibility supplied by the backend',()=>{const context=vm.createContext({esc:String,virtualProgressTime:()=>''});vm.runInContext(source.slice(source.indexOf('function virtualProgressCard('),source.indexOf('function trackingCard(')),context);assert.equal(context.virtualProgressCard({virtualProgress:null},true),'');const html=context.virtualProgressCard({virtualProgress:{simulated:true,events:[]},tracking:[],shipments:[]},true);assert.match(html,/Order processing will begin shortly/);assert.match(html,/复制全部进度/);});
