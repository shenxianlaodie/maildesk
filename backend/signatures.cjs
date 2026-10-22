'use strict';
const {createHash,randomInt}=require('node:crypto');
const key='staff_signatures';
function readSignatures(db){
 const saved=db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
 return saved?JSON.parse(saved.value):['Daisy','Jack','Debbie'].map(code=>({code,staffId:null}));
}
function saveSignature(db,input){
 const rows=readSignatures(db),code=typeof input.code==='string'?input.code.trim():'';
 if(!/^[A-Za-z0-9_-]{1,40}$/.test(code))throw Error('SIGNATURE_CODE_INVALID');
 if(input.action==='add'){
  if(rows.some(r=>r.code.toLowerCase()===code.toLowerCase()))throw Error('SIGNATURE_CODE_EXISTS');
  rows.push({code,staffId:null});
 }else if(input.action==='bind'){
  const row=rows.find(r=>r.code===code);if(!row)throw Error('SIGNATURE_CODE_MISSING');
  const id=input.staffId||null;
  if(id&&(typeof id!=='string'||!db.prepare('SELECT id FROM staff WHERE id=? AND active=1').get(id)))throw Error('SIGNATURE_STAFF_INVALID');
  if(id&&rows.some(r=>r!==row&&r.staffId===id))throw Error('SIGNATURE_STAFF_BOUND');
  row.staffId=id;
 }else throw Error('SIGNATURE_ACTION_INVALID');
 db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(key,JSON.stringify(rows));
 return {saved:true};
}
function assignUnusedSignature(store,staffId){
 return store.transaction(()=>{
  const rows=readSignatures(store.db),existing=rows.find(row=>row.staffId===staffId);
  if(existing)return existing.code;
  store.actor(staffId);
  const available=rows.filter(row=>!row.staffId);if(!available.length)return null;
  const chosen=available[randomInt(available.length)];chosen.staffId=staffId;
  store.db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run(key,JSON.stringify(rows));
  return chosen.code;
 });
}
function signatureFor(rows,identity){
 const id=require('./staff-identity.cjs').staffId(identity);if(!id)return null;
 const row=rows.find(r=>r.staffId===id);
 return row?{code:row.code,text:`Best regards,\n${row.code}\nCustomer Support Team`}:null;
}
module.exports={readSignatures,saveSignature,signatureFor,assignUnusedSignature};
