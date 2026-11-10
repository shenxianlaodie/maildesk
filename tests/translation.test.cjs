'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../backend/database.cjs');
const {installDesk,deskRoute}=require('../backend/desk.cjs');
function fixture(text){const store=new Store(':memory:');installDesk(store.db);store.addInbox({id:'i',address:'support@example.com'});const m=store.upsertMessage({inboxId:'i',providerId:'m',direction:'inbound',customerEmail:'test@example.com',fromAddress:'test@example.com',bodyText:text,sentAt:'2026-11-10T00:00:00Z'});return{store,m};}
const config={apiKey:'fake',model:'test',apiType:'responses',baseUrl:'https://api.deepseek.com'};
test('translation does not send provider-specific reasoning options to other endpoints or general AI calls',async()=>{
 const {translate}=require('../backend/translation.cjs'),{generate}=require('../backend/ai-client.cjs');let calls=0;
 const mock=async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.reasoning,undefined);calls++;return new Response(JSON.stringify({status:'completed',output_text:'译文'}));};
 await translate({...config,baseUrl:'https://other.example/v1'},'Hello',mock);
 await generate(config,'Classify','Hello',{fetchImpl:mock});assert.equal(calls,2);
});
test('translation sends complete long mail in bounded chunks and preserves order despite response timing',async()=>{
 const text=('邮件段落 😀 with historical context.\n').repeat(1000),{store,m}=fixture(text);let active=0,peak=0;const inputs=[];
 try{const result=await deskRoute({store,url:new URL('http://localhost/api/desk/translate'),method:'POST',input:{messageId:m.id},vault:{get:()=>config},demo:false,fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body),part=JSON.parse(body.input).text,index=inputs.length;inputs.push(part);
  assert.ok(part.length<=3001);assert.ok(body.max_output_tokens>=8192);assert.deepEqual(body.reasoning,{effort:'none'});active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,index===0?20:1));active--;
  return new Response(JSON.stringify({status:'completed',output_text:'译文'+index}));
 }});assert.equal(inputs.join(''),text);assert.ok(peak<=3);assert.ok(peak>1);assert.equal(result.text,inputs.map((_,i)=>'译文'+i).join('\n\n'));}finally{store.close();}
});
test('translation does not present partial success if a segment is incomplete',async()=>{
 const {store,m}=fixture('long email '.repeat(1000));
 try{await assert.rejects(deskRoute({store,url:new URL('http://localhost/api/desk/translate'),method:'POST',input:{messageId:m.id},vault:{get:()=>config},demo:false,fetchImpl:async()=>new Response(JSON.stringify({status:'incomplete',output_text:'partial',incomplete_details:{reason:'max_output_tokens'}}))}),/AI_INCOMPLETE/);}finally{store.close();}
});
