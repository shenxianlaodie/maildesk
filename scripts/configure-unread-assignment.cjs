'use strict';
const fs=require('node:fs');
function configure(db,{apply=false}={}){
 const row=db.prepare("SELECT value FROM app_settings WHERE key='unread_auto_assignment'").get();if(!row)throw Error('EXISTING_ASSIGNMENT_CONFIG_REQUIRED');const previous=JSON.parse(row.value);
 const names=['客服01','客服02','客服03','李惠'];if(!Array.isArray(previous.staffIds)||previous.staffIds.length!==4||new Set(previous.staffIds).size!==4)throw Error('EXPECTED_FOUR_EXISTING_ACCOUNTS');
 const staff=previous.staffIds.map(id=>db.prepare('SELECT id,display_name,active FROM staff WHERE id=?').get(id));if(staff.some(s=>!s||s.active!==1)||names.some(name=>staff.filter(s=>s.display_name===name).length!==1))throw Error('EXPECTED_FOUR_EXISTING_ACCOUNTS');
 const next={...previous,enabled:true,target:20,transferExcess:true};if(apply){db.exec('BEGIN IMMEDIATE');try{const result=db.prepare("UPDATE app_settings SET value=? WHERE key='unread_auto_assignment' AND value=?").run(JSON.stringify(next),row.value);if(result.changes!==1)throw Error('CONFIG_CHANGED');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 return{applied:apply,staff,previous,next};
}
if(require.main===module){const args=process.argv.slice(2);const database=args.find(a=>!a.startsWith('--'));if(!database||!fs.existsSync(database)||args.some(a=>a.startsWith('--')&&!['--apply','--dry-run'].includes(a))||args.includes('--apply')&&args.includes('--dry-run'))throw Error('Usage: node scripts/configure-unread-assignment.cjs EXISTING_DATABASE [--dry-run|--apply]');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(database,{readOnly:!args.includes('--apply')});try{console.log(JSON.stringify(configure(db,{apply:args.includes('--apply')}),null,2));}finally{db.close();}}
module.exports={configure};
