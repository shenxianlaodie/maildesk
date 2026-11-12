'use strict';
let mabangData=null,mabangBusy=false,mabangStatus='pending',mabangQuery='';
const mabangSelected=new Set();
let mabangConfirming=false;
function mabangVisibleRows(){const term=mabangQuery.trim().toLowerCase();return (mabangData?.rows||[]).filter(r=>(mabangStatus==='all'||(mabangStatus==='pending'?r.pending:!r.pending))&&(!term||[r.order_number,r.store_domain].some(s=>s.toLowerCase().includes(term))));}
function mabangPruneSelection(){const visible=new Set(mabangVisibleRows().map(r=>r.request_id));for(const id of mabangSelected)if(!visible.has(id))mabangSelected.delete(id);}
function mabangSelectedRows(){return mabangVisibleRows().filter(r=>mabangSelected.has(r.request_id));}
function mabangSelectAll(checked){for(const r of mabangVisibleRows())if(checked)mabangSelected.add(r.request_id);else mabangSelected.delete(r.request_id);}
function mabangSelectionControls(){
 const count=mabangSelectedRows().length,total=mabangVisibleRows().length,all=$('#mabang-select-all');
 if(!all)return;all.checked=total>0&&count===total;all.indeterminate=count>0&&count<total;all.disabled=!total;
 $('#mabang-selected-count').textContent=`已选 ${count} / ${total} 单`;
 $('#mabang-confirm-selected').disabled=mabangConfirming||!mabangSelectedRows().some(r=>r.pending);
 $('#mabang-export').disabled=!count;$('#mabang-copy-orders').disabled=!count;
 $$('[data-mabang-select]').forEach(n=>{n.checked=mabangSelected.has(n.dataset.mabangSelect);});
}
async function confirmSelectedMabangAddresses(){
 if(mabangConfirming)return;
 const rows=mabangSelectedRows().filter(r=>r.pending);if(!rows.length)return;
 if(!confirm(`确认选中的 ${rows.length} 单已在马帮导入或修改成功？此操作仅记录已同步状态。`))return;
 mabangConfirming=true;mabangSelectionControls();
 try{
  await api('desk/mabang-address',{requestIds:rows.map(r=>r.request_id)});
  for(const r of rows){r.pending=false;mabangSelected.delete(r.request_id);}
  toast(`已将 ${rows.length} 单标记为已同步。`);
  try{await mabangRefresh();}catch{toast('已同步状态已保存，列表刷新失败，请稍后刷新。');}
 }catch(e){toast(mabangErrors[e.message]||'批量确认失败，请刷新核对后重试。');}
 finally{mabangConfirming=false;renderMabangAddresses();}
}
async function exportMabangAddresses(){
 const selected=mabangSelectedRows().map(r=>r.request_id);if(!selected.length)return;
 const button=$('#mabang-export');button.disabled=true;button.textContent='正在生成…';
 try{
  const fresh=await api('desk/mabang-address?status=all&refresh=1');
  if(fresh.error)throw Error('改址记录同步失败，请稍后重试。');
  mabangData=fresh;mabangPruneSelection();const rows=mabangSelectedRows();
  if(rows.length!==selected.length||rows.some(r=>!selected.includes(r.request_id)))throw Error('所选订单已有新地址或状态变化，请重新核对并勾选。');
  const bytes=MabangExport.build(rows),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download=`马帮地址更新_${new Date().toISOString().slice(0,10)}_${rows.length}单.xlsx`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast(`已下载 ${rows.length} 单。马帮导入成功后再确认已同步。`);
 }catch(e){toast(mabangErrors[e.message]||e.message||'导出失败，请重试。');}
 finally{renderMabangAddresses();}
}
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
 mabangPruneSelection();const rows=mabangVisibleRows();
 modal('待同步马帮',`<p>店匠地址已更新，马帮需要人工修改。确认前请在马帮核对并保存最新地址。</p>
 <p role="status">${mabangData.error?esc(mabangData.error):mabangData.last_success?'最近核对：'+esc(fullTime(mabangData.last_success)):'正在回查历史记录'} · 待处理 ${mabangData.pending} 单</p>
 <div class="address-actions" style="display:flex;flex-wrap:wrap;gap:8px"><input id="mabang-search" style="flex:1;min-width:140px" placeholder="搜索订单号／店铺" aria-label="搜索改址订单" value="${esc(mabangQuery)}"><select id="mabang-status" aria-label="马帮同步状态">${[['pending','待核对／待同步'],['done','已人工同步'],['all','全部']].map(([v,t])=>`<option value="${v}" ${mabangStatus===v?'selected':''}>${t}</option>`).join('')}</select><button id="mabang-search-button" class="soft" style="white-space:nowrap;flex-shrink:0">查询</button><button id="mabang-refresh" class="soft" style="white-space:nowrap;flex-shrink:0">刷新</button></div>
 <div class="mabang-batch-actions"><label><input type="checkbox" id="mabang-select-all"> 全选当前结果</label><span id="mabang-selected-count" role="status"></span><button id="mabang-copy-orders" class="soft" disabled>复制选中订单号</button><button id="mabang-export" class="primary" disabled>导出选中订单</button><button id="mabang-confirm-selected" class="primary" disabled>选中订单标记已同步</button></div>
 <p class="help">订单号每行一个。导出后仍保留待处理，马帮导入成功后再确认。</p>
 <div>${rows.length?rows.map(r=>`<section class="detail-card"><h3><label class="mabang-order-select"><input type="checkbox" data-mabang-select="${esc(r.request_id)}" aria-label="选择订单 ${esc(r.order_number)}"> ${esc(r.order_number)}</label> <span class="tag ${r.pending?'orange':'green'}">${r.pending?'待同步马帮':'已人工同步'}</span></h3><p>${esc(r.store_domain)} · ${mabangSource(r)} · ${esc(fullTime(r.completed_at))}</p><details><summary>原地址</summary><pre style="white-space:pre-wrap">${esc(mabangAddress(r.before))}</pre></details><strong>最新成功修改的地址</strong><pre style="white-space:pre-wrap">${esc(mabangAddress(r.after))}</pre>${r.confirmed_at?`<p>处理人：${esc(r.confirmed_by)} · ${esc(fullTime(r.confirmed_at))}</p>`:''}<div class="address-actions"><button class="soft" data-mabang-copy="${esc(r.request_id)}">复制新地址</button><button class="soft" data-mabang-history="${esc(r.request_id)}">改址历史</button>${r.pending?`<button class="primary" data-mabang-confirm="${esc(r.request_id)}">已同步马帮</button>`:''}</div></section>`).join(''):'<p>没有符合条件的订单。</p>'}</div>`);
 $('#mabang-select-all').onchange=e=>{mabangSelectAll(e.target.checked);mabangSelectionControls();};
 $$('[data-mabang-select]').forEach(n=>n.onchange=()=>{if(n.checked)mabangSelected.add(n.dataset.mabangSelect);else mabangSelected.delete(n.dataset.mabangSelect);mabangSelectionControls();});
 $('#mabang-copy-orders').onclick=run(()=>copy(MabangExport.orderNumbers(mabangSelectedRows())));
 $('#mabang-confirm-selected').onclick=confirmSelectedMabangAddresses;
 $('#mabang-export').onclick=exportMabangAddresses;mabangSelectionControls();
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
