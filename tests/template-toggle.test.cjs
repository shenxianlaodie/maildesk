const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('template toggle removes only inserted text, tracks surrounding edits and isolates customers',()=>{
 const source=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8');
 const state={id:'a',draft:'Hello ',meta:{templates:[{id:'one',body:'ONE'},{id:'two',body:'TWO'}]}};
 let c;const area={value:state.draft,selectionStart:6,selectionEnd:6,focus(){},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(){c.updateTemplateRanges(state.draft,this.value);state.draft=this.value;}};
 c=vm.createContext({state,document:{querySelectorAll:()=>[]},$:()=>area,sendingReplies:new Map(),lastInbound:()=>true,templateValues:()=>({}),order:()=>null,fillTemplate:body=>({text:body,missing:[]}),toast(){},Event:class{}});
 vm.runInContext(source.slice(source.indexOf('function signatureRangeAfterEdit('),source.indexOf('function signatureButton(')),c);
 vm.runInContext(source.slice(source.indexOf('function insertText('),source.indexOf('\n',source.indexOf('function insertText('))),c);
 vm.runInContext(source.slice(source.indexOf('const replyTemplates='),source.indexOf('let phraseObserver')),c);
 c.insertTemplate('one');assert.equal(area.value,'Hello ONE');
 area.value='Prefix '+area.value;area.dispatchEvent();c.insertTemplate('one');assert.equal(area.value,'Prefix Hello ');
 area.setSelectionRange(area.value.length,area.value.length);c.insertTemplate('one');c.insertTemplate('two');c.insertTemplate('one');assert.equal(area.value,'Prefix Hello TWO');c.insertTemplate('two');assert.equal(area.value,'Prefix Hello ');
 area.setSelectionRange(area.value.length,area.value.length);c.insertTemplate('one');area.value=area.value.replace('ONE','Edited');area.dispatchEvent();assert.equal(vm.runInContext('replyTemplates.get("a").has("one")',c),false);
 state.id='b';state.draft='';area.value='';area.setSelectionRange(0,0);c.insertTemplate('one');assert.equal(area.value,'ONE');c.insertTemplate('one');assert.equal(area.value,'');
});
