const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../backend/public/desk/app.js'),'utf8');
test('reply grows and shrinks with text, caps editor at two thirds and preserves thread space',()=>{
 const area={style:{},offsetHeight:65,scrollHeight:1200,closest:s=>s==='.composer'?composer:main};
 const composer={offsetHeight:165},thread={},main={clientHeight:900,children:[composer,thread]};thread.id='thread';
 const c=vm.createContext({$:()=>area,window:{innerHeight:900},getComputedStyle:()=>({marginTop:'0',marginBottom:'0',minHeight:'100'})});
 vm.runInContext(source.slice(source.indexOf('function resizeReply(){'),source.indexOf('function observeReplySize(){')),c);
 c.resizeReply();assert.equal(area.style.height,'500px');assert.equal(area.style.overflowY,'auto');
 area.scrollHeight=40;c.resizeReply();assert.equal(area.style.height,'65px');assert.equal(area.style.overflowY,'hidden');
 main.clientHeight=400;area.scrollHeight=1200;c.resizeReply();assert.equal(area.style.height,'196px');
});
