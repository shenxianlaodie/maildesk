'use strict';
let mabangData=null,mabangBusy=false,mabangStatus='pending',mabangQuery='';
const mabangErrors={MABANG_ADDRESS_CHANGED:'这笔订单又有新地址，请刷新后核对最新地址。',MABANG_SYNC_UNAVAILABLE:'改址记录同步失败，暂不能确认。请稍后重试。',MAILBOX_FORBIDDEN:'没有该店铺的处理权限。',MABANG_UNAVAILABLE:'改址提醒尚未配置。'};
function mabangAddress(a){return [a.first_name,a.last_name,a.name,a.phone_area_code,a.phone,a.company,a.address,a.address1,a.area,a.city,a.province,a.province_code,a.zip,a.country,a.country_code].filter(Boolean).join('\n');}
function mabangSource(r){return r.source==='customer'?'顾客自助':'客服／其他入口';}
async function mabangRefresh(force=false){
 if(mabangBusy||!state.token||!state.meta)return;
 mabangBusy=true;
 try{
  mabangData=await api('desk/mabang-address?status=all'+(force?'&refresh=1':''));
  document.querySelectorAll('[data-mabang-count]').forEach(n=>{n.textContent=mabangData.error?'待同步马帮 !':`${n.hasAttribute('data-mabang-compact')?'马帮':'待同步马帮'} (${mabangData.pending})`;n.title=mabangData.error||'店匠地址修改成功后，需人工更新马帮';});
  window.refreshMabangOrderBadge?.(order());
 }catch(e){document.querySelectorAll('[data-mabang-count]').forEach(n=>{n.textContent='待同步马帮 !';n.title=mabangErrors[e.message]||'提醒读取失败，请点击重试';});throw e;}finally{mabangBusy=false;}
}
window.refreshMabangOrderBadge=function(o){
 const n=document.querySelector('#mabang-order-warning');if(!n)return;
 const domain=x=>String(x||'').replace(/\.myshoplaza\.com$/i,'').toLowerCase();
 const match=mabangData?.rows.find(r=>r.pending&&r.order_id===o?.provider_id&&domain(r.store_domain)===domain(o?.shop_domain));
 n.hidden=!match;
 n.textContent=match?'地址已修改，待同步马帮':'';n.onclick=()=>{mabangQuery=match.order_number;mabangStatus='pending';openMabangAddresses();};
};
async function openMabangAddresses(){
 modal('待同步马帮','<p>正在读取成功改址记录…</p>');
 try{await mabangRefresh(true);renderMabangAddresses();}catch(e){modal('待同步马帮',`<p role="alert">${esc(mabangErrors[e.message]||'读取失败，请稍后重试。')}</p>`);}
}
function renderMabangAddresses(){
 if(!mabangData)return;
 const term=mabangQuery.trim().toLowerCase();
 const rows=mabangData.rows.filter(r=>(mabangStatus==='all'||(mabangStatus==='pending'?r.pending:!r.pending))&&(!term||[r.order_number,r.store_domain].some(s=>s.toLowerCase().includes(term))));
 modal('待同步马帮',`<p>店匠地址已更新，马帮需要人工修改。确认前请在马帮核对并保存最新地址。</p>
 <p role="status">${mabangData.error?esc(mabangData.error):mabangData.last_success?'最近核对：'+esc(fullTime(mabangData.last_success)):'正在回查历史记录'} · 待处理 ${mabangData.pending} 单</p>
 <div class="address-actions" style="display:flex;flex-wrap:wrap;gap:8px"><input id="mabang-search" style="flex:1;min-width:140px" placeholder="搜索订单号／店铺" aria-label="搜索改址订单" value="${esc(mabangQuery)}"><select id="mabang-status" aria-label="马帮同步状态">${[['pending','待核对／待同步'],['done','已人工同步'],['all','全部']].map(([v,t])=>`<option value="${v}" ${mabangStatus===v?'selected':''}>${t}</option>`).join('')}</select><button id="mabang-search-button" class="soft" style="white-space:nowrap;flex-shrink:0">查询</button><button id="mabang-refresh" class="soft" style="white-space:nowrap;flex-shrink:0">刷新</button></div>
 <div>${rows.length?rows.map(r=>`<section class="detail-card"><h3>${esc(r.order_number)} <span class="tag ${r.pending?'orange':'green'}">${r.pending?'待同步马帮':'已人工同步'}</span></h3><p>${esc(r.store_domain)} · ${mabangSource(r)} · ${esc(fullTime(r.completed_at))}</p><details><summary>原地址</summary><pre style="white-space:pre-wrap">${esc(mabangAddress(r.before))}</pre></details><strong>最新成功修改的地址</strong><pre style="white-space:pre-wrap">${esc(mabangAddress(r.after))}</pre>${r.confirmed_at?`<p>处理人：${esc(r.confirmed_by)} · ${esc(fullTime(r.confirmed_at))}</p>`:''}<div class="address-actions"><button class="soft" data-mabang-copy="${esc(r.request_id)}">复制新地址</button><button class="soft" data-mabang-history="${esc(r.request_id)}">改址历史</button>${r.pending?`<button class="primary" data-mabang-confirm="${esc(r.request_id)}">已同步马帮</button>`:''}</div></section>`).join(''):'<p>没有符合条件的订单。</p>'}</div>`);
 $('#mabang-search-button').onclick=()=>{mabangQuery=$('#mabang-search').value;renderMabangAddresses();};
 $('#mabang-search').onkeydown=e=>{if(e.key==='Enter')$('#mabang-search-button').click();};
 $('#mabang-status').onchange=e=>{mabangStatus=e.target.value;mabangQuery=$('#mabang-search').value;renderMabangAddresses();};
 $('#mabang-refresh').onclick=()=>openMabangAddresses();
 $$('[data-mabang-copy]').forEach(b=>b.onclick=run(()=>copy(mabangAddress(mabangData.rows.find(r=>r.request_id===b.dataset.mabangCopy).after))));
 $$('[data-mabang-history]').forEach(b=>b.onclick=run(async()=>{
  const history=await api('desk/mabang-address?history='+encodeURIComponent(b.dataset.mabangHistory));
  modal('改址历史',`<button id="mabang-back" class="soft">返回待办</button>${history.rows.map(r=>`<section class="detail-card"><p>${esc(fullTime(r.completed_at))} · ${mabangSource(r)} · 请求 #${esc(r.request_id)}</p><pre style="white-space:pre-wrap">${esc(mabangAddress(r.before))}\n↓\n${esc(mabangAddress(r.after))}</pre><p>${r.confirmed_at?'人工同步：'+esc(r.confirmed_by)+' · '+esc(fullTime(r.confirmed_at)):'无人工同步确认记录'}</p></section>`).join('')}`);$('#mabang-back').onclick=renderMabangAddresses;
 }));
 $$('[data-mabang-confirm]').forEach(b=>b.onclick=async()=>{
  const r=mabangData.rows.find(r=>r.request_id===b.dataset.mabangConfirm);
  if(!confirm(`确认已在马帮修改并保存订单 ${r.order_number} 的最新地址？`))return;
  b.disabled=true;
  try{await api('desk/mabang-address',{requestId:r.request_id});await mabangRefresh();renderMabangAddresses();toast('已记录人工同步结果。');}
  catch(e){toast(mabangErrors[e.message]||'确认失败，请重试。');b.disabled=false;}
 });
}
setInterval(()=>{if(!document.hidden)mabangRefresh().catch(()=>{});},30000);
const mabangStartup=setInterval(()=>{if(state.meta&&state.token){clearInterval(mabangStartup);mabangRefresh().catch(()=>{});}},500);
