const active=new Set();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.type!=='read-tracking'||sender.frameId!==0||!sender.tab?.id)return;
 let url;try{url=new URL(sender.url);}catch{return;}
 if(url.origin!=='https://chat.thinkpro.top'||!url.pathname.startsWith('/maildesk/'))return;
 if(!/^[A-Za-z0-9][A-Za-z0-9-]{4,99}$/.test(message.number)||!/^[a-f0-9-]{36}$/i.test(message.requestId))return;
 const tabId=sender.tab.id;if(active.has(tabId)){reply({error:'正在读取物流，请稍候。'});return;}active.add(tabId);
 (async()=>{
  const frames=(await chrome.webNavigation.getAllFrames({tabId})).filter(f=>{try{return new URL(f.url).origin==='https://extcall.17track.net';}catch{return false;}});
  if(!frames.length)throw Error('请先展开物流信息，等待17TRACK查询结果加载完成。');
  const found=[];
  for(const frame of frames){try{const results=await chrome.scripting.executeScript({target:{tabId,frameIds:[frame.frameId]},func:(number)=>{
   if(location.origin!=='https://extcall.17track.net')return null;
   // Read the same payload used by 17TRACK's Copy Details action, without touching the clipboard.
   const details=[...new Set([...document.querySelectorAll('[data-copy-details][data-clipboard-text]')].map(el=>el.getAttribute('data-clipboard-text')).filter(text=>typeof text==='string'&&text.length>=20&&text.length<=24000&&(text.toUpperCase().match(/[A-Z0-9][A-Z0-9-]{4,99}/g)||[]).includes(number.toUpperCase())))];
   if(details.length!==1)return null;
   return{number,text:details[0],copyDetails:details[0],sourceUrl:location.href};
  },args:[message.number]});for(const r of results)if(r.result)found.push(r.result);}catch{}}
  if(found.length!==1)throw Error(found.length?'找到多个相同运单页面，请只保留当前查询后重试。':'尚未读取到该运单的 Copy Details，请等待查询完成后重试。');
  reply({capture:found[0]});
 })().catch(e=>reply({error:e.message})).finally(()=>active.delete(tabId));return true;
});
