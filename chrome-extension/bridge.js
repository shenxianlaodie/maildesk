window.addEventListener('message',async event=>{
 if(event.source!==window||event.origin!==location.origin)return;
 const data=event.data;if(data?.type==='maildesk-tracking-ping'){window.postMessage({type:'maildesk-tracking-ready'},location.origin);return;}
 if(data?.type!=='maildesk-tracking-request')return;
 const {requestId,number}=data;
 if(!/^[a-f0-9-]{36}$/i.test(requestId)||!/^[A-Za-z0-9][A-Za-z0-9-]{4,99}$/.test(number))return;
 let response;try{response=await chrome.runtime.sendMessage({type:'read-tracking',requestId,number});}catch{response={error:'扩展连接失效，请刷新客服页面后重试。'};}
 window.postMessage({type:'maildesk-tracking-result',requestId,number,...response},location.origin);
});
