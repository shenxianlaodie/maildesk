'use strict';
const $=s=>document.querySelector(s),params=new URLSearchParams(location.hash.slice(1));
let token='',original={},pending=null,request=null,timer,opening=false;
const texts={RATE_LIMITED:'Too many attempts. Please try again later or contact customer support.',ORDER_LOOKUP_FAILED:'The order number and email do not match. Please check your order details.',VERIFICATION_REQUIRED:'Your order session has expired. Please reopen the address form from your order page.',ORDER_NOT_EDITABLE:'This order cannot be changed online. It may already be shipped, cancelled or completed. Please contact customer support.',ORDER_ADDRESS_WINDOW_EXPIRED:'The 48-hour address change window has closed. Please contact customer support.',ORDER_ADDRESS_TIME_UNKNOWN:'We could not confirm the order date. Please contact customer support.',COUNTRY_CHANGE_UNAVAILABLE:'Please contact customer support to change the destination country.',active_address_request_exists:'An address change is already being processed. Please contact customer support for its result.',INVALID_ADDRESS:'Please complete the address and choose a valid country and calling code.',SERVICE_UNAVAILABLE:'The service is temporarily unavailable. Please try again.'};
function notice(text,type=''){const el=$('#notice');el.textContent=text;el.className=type;}
async function api(action,data={}){const r=await fetch('api/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(25000)});const result=await r.json();if(!r.ok){const e=Error(result.error);e.code=result.error;e.editRejected=result.editRejected;throw e;}return result;}
function error(e){notice(texts[e.code]||'We could not confirm the result. Please try again or contact customer support.','error');if(e.code==='VERIFICATION_REQUIRED'){token='';$('#lookup').hidden=false;$('#address').hidden=true;}}
async function busy(form,work){const button=form.querySelector('button[type="submit"]');button.disabled=true;try{await work();}catch(e){error(e);}finally{button.disabled=false;}}
$('#lookup').elements.order.value=params.get('order')||'';
async function openOrder(data){
 if(opening)return;opening=true;
 try{notice('Loading your shipping address…');clearTimeout(timer);token='';pending=null;request=null;$('#retry').hidden=true;
  const r=await api('lookup',data);token=r.token;const view=await api('read');$('#lookup').hidden=true;
  $('#order-reference').textContent='Order '+data.order;$('#order-reference').hidden=false;
  if(view.request)result(view.request);else if(view.resumePatch){pending=view.resumePatch;notice('An earlier request needs confirmation. Check it before submitting another change.');$('#retry').hidden=false;}else renderAddress(view);
 }catch(e){$('#lookup').hidden=false;error(e);}finally{opening=false;}
}
$('#lookup').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,()=>openOrder({...Object.fromEntries(new FormData($('#lookup'))),store:params.get('store')}));});
// The parent supplies lookup fields, not authorization. The server matches both fields before granting access.
if(window.parent!==window){
 $('#lookup').hidden=true;notice('Loading your order…');
 window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='maildesk-address-order'||token||opening)return;
  const {store,order,email}=event.data;
  if(store!==params.get('store')||typeof order!=='string'||typeof email!=='string'||!order||!email){$('#lookup').hidden=false;notice('Enter the order number and email to view your address.');return;}
  $('#lookup').elements.order.value=order;$('#lookup').elements.email.value=email;openOrder({store,order,email});
 });
 window.parent.postMessage({type:'maildesk-address-ready'},'*');
}
const fields=[['first_name','First name',true],['last_name','Last name'],['phone','Phone number'],['phone_area_code','Calling code'],['address','Street address',true],['address1','Address line 2 (optional)'],['city','City',true],['province','State / Province'],['zip','Postal code'],['country','Country']];
function renderAddress(view){
 original=view.address;const container=$('#fields');container.replaceChildren();
 for(const [name,label,required]of fields){const el=document.createElement('label'),input=document.createElement('input');el.textContent=label;input.name=name;input.value=name==='phone_area_code'?AddressForm.dialCode(original[name]):original[name]||'';input.maxLength=200;input.required=!!required;if(name==='phone'||name==='phone_area_code')input.type='tel';el.append(input);container.append(el);}
 const form=$('#address'),country=form.elements.country,province=form.elements.province,phone=form.elements.phone,calling=form.elements.phone_area_code;
 function list(input,id,rows){let datalist=document.getElementById(id);if(!datalist){datalist=document.createElement('datalist');datalist.id=id;container.append(datalist);}datalist.replaceChildren();for(const name of rows){const option=document.createElement('option');option.value=name;datalist.append(option);}input.setAttribute('list',id);input.autocomplete='off';}
 list(country,'country-choices',AddressForm.countries.map(c=>c.name));country.required=true;
 let selectedCountry=original.country_code;
 function regionChoices(){const c=AddressForm.findCountry(country.value);list(province,'province-choices',AddressForm.provinces(c?.code===original.country_code?original:{country_code:c?.code||''}).map(r=>r.name));}
 country.addEventListener('input',()=>{const c=AddressForm.findCountry(country.value);country.setCustomValidity(c||country.value===original.country?'':'Choose a country from the suggestions.');if(c&&c.code!==selectedCountry){selectedCountry=c.code;province.value='';}regionChoices();});regionChoices();
 phone.addEventListener('input',()=>{const code=AddressForm.phoneCode(phone.value);if(code)calling.value=code;});
 calling.addEventListener('input',()=>{const code=AddressForm.dialCode(calling.value);if(!code||AddressForm.phoneCode(code)!==code)return;const old=AddressForm.phoneCode(phone.value);if(old&&old!==code){const compact=phone.value.trim().replace(/^00/,'+');phone.value=code+compact.slice(old.length);}calling.value=code;});
 $('#address').hidden=!view.eligibility.allowed;if(!view.eligibility.allowed)notice(texts[view.eligibility.error]||texts.ORDER_NOT_EDITABLE,'error');else notice('Review your address, then confirm the change.');
}
function result(r){request=r;$('#retry').hidden=true;clearTimeout(timer);if(r.status==='succeeded'){notice('Your shipping address has been updated.','success');$('#address').hidden=true;pending=null;return;}if(['failed','conflict'].includes(r.status)){notice(r.status==='conflict'?'The order address changed while you were editing. Start again and review the latest address.':'The address change was not completed. Please contact customer support.','error');$('#address').hidden=true;$('#lookup').hidden=false;pending=null;return;}notice(r.status==='uncertain'?'Your request is being checked. Please do not submit another change.':'Your address change is being processed. Please keep this page open.');$('#address').hidden=true;if(!document.hidden)timer=setTimeout(poll,3000);}
async function poll(){try{result(await api('status',{id:request.id}));}catch(e){error(e);$('#retry').hidden=false;}}
async function submit(){try{result(await api('submit',{patch:pending}));}catch(e){if(e.editRejected){pending=null;request=null;$('#retry').hidden=true;try{renderAddress(await api('read'));}catch(readError){error(readError);return;}error(e);}else{error(e);$('#retry').hidden=false;}}}
$('#address').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{if(!pending){const patch=AddressForm.patch(original,Object.fromEntries(new FormData($('#address'))));if(!Object.keys(patch).length){notice('Your address has not changed.');return;}pending=patch;}notice('Submitting your address change…');await submit();});});
$('#retry').onclick=()=>{if(request)poll();else if(pending)submit();};
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&request&&['pending','processing','uncertain'].includes(request.status))poll();});
