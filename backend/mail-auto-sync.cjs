'use strict';
function createMailAutoSync(db,run,{defaultEnabled=false,intervalMs=60000,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>console.error('MAIL_AUTO_SYNC_FAILED')}={}){
 const saved=db.prepare("SELECT value FROM app_settings WHERE key='mail_auto_sync'").get();
 let enabled=saved?saved.value==='true':defaultEnabled,started=false,closed=false,timer=null,running=false,pending=Promise.resolve();
 function schedule(delay){if(!started||closed||!enabled||running||timer!==null)return;timer=setTimer(()=>{timer=null;tick();},delay);timer?.unref?.();}
 function tick(){if(closed||!enabled||running)return;running=true;pending=Promise.resolve().then(()=>run(()=>enabled&&!closed)).catch(onError).finally(()=>{running=false;schedule(intervalMs);});}
 return {
  enabled:()=>enabled,
  start(){if(started)return;started=true;schedule(0);},
  setEnabled(value){if(typeof value!=='boolean')throw Error('INVALID_AUTO_SYNC');db.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES(?,?)').run('mail_auto_sync',String(value));enabled=value;if(timer!==null){clearTimer(timer);timer=null;}schedule(0);return{saved:true,enabled};},
  async close(){closed=true;if(timer!==null){clearTimer(timer);timer=null;}await pending;}
 };
}
module.exports={createMailAutoSync};
