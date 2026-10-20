'use strict';
const {aiConfig,endpoint}=require('./connection-config.cjs');
async function generate(config,instructions,input,{schema,maxTokens=1400,fetchImpl=fetch}={}){const c=aiConfig(config);if(!c.apiKey)throw Error('AI_CONFIG_REQUIRED');const jsonInput=typeof input==='string'?input:JSON.stringify(input);let body;
 if(c.apiType==='responses'){body={model:c.model,store:false,instructions,input:jsonInput,max_output_tokens:maxTokens};if(schema)body.text={format:{type:'json_schema',name:'mail_classification',strict:true,schema}};}
 else{body={model:c.model,messages:[{role:'system',content:instructions+(schema?'\n仅返回符合此 JSON Schema 的 JSON，不要使用 Markdown：'+JSON.stringify(schema):'')},{role:'user',content:jsonInput}],stream:false};}
 let response;try{response=await fetchImpl(endpoint(c),{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),headers:{Authorization:'Bearer '+c.apiKey,'Content-Type':'application/json'},body:JSON.stringify(body)});}catch{throw Error('AI_NETWORK_FAILED');}if(!response.ok)throw Error('AI_HTTP_'+response.status);let data;try{data=await response.json();}catch{throw Error('AI_INVALID_RESULT');}
 let text;if(c.apiType==='responses'){if(data.status&&data.status!=='completed')throw Error('AI_INCOMPLETE');text=(data.output||[]).flatMap(o=>o.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('')||data.output_text;}
 else{const choice=data.choices?.[0];if(choice?.finish_reason&&choice.finish_reason!=='stop')throw Error('AI_INCOMPLETE');const content=choice?.message?.content;text=typeof content==='string'?content:Array.isArray(content)?content.map(x=>x.text||'').join(''):'';}
 if(typeof text!=='string'||!text.trim())throw Error('AI_INCOMPLETE');return text.trim();}
module.exports={generate};
