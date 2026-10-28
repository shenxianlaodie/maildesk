const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../backend/public/desk/app.js'),'utf8');
function render(inboxes){
 const dialog={innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]};
 const c=vm.createContext({state:{meta:{accounts:{inboxes}}},requestUUID:()=> 'draft',icon:()=>'',esc:String});
 vm.runInContext(source.slice(source.indexOf('function emptyCompose('),source.indexOf('function openCompose(')),c);
 c.dialog=dialog;vm.runInContext('composeDialog=dialog;',c);
 vm.runInContext(source.slice(source.indexOf('function renderCompose('),source.indexOf('function modal(')),c);
 c.renderCompose();return dialog.innerHTML;
}
test('compose lists permitted mailboxes regardless of receive-sync or SMTP metadata flags',()=>{
 const html=render([{id:'allowed',address:'allowed@example.com',enabled:false,smtpConfigured:true},{id:'legacy',address:'legacy@example.com'}]);
 assert.match(html,/<option value="allowed"/);assert.match(html,/<option value="legacy"/);
 assert.doesNotMatch(html,/没有可用的发件邮箱/);
});
test('compose keeps send disabled when permission scope contains no mailboxes',()=>{
 const html=render([]);assert.match(html,/没有可用的发件邮箱/);assert.match(html,/type="submit" disabled/);
});

