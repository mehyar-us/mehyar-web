// Synthetic only: no network, credentials, production reads, or email sending.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {businessRecoveryFixtureSql} from './business-recovery-fixture.mjs';
const output=process.argv[2];if(!output)throw new Error('Supply a new output SQL file path.');
const migrations=fileURLToPath(new URL('../../migrations/',import.meta.url));
const schema=readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort().map(n=>readFileSync(join(migrations,n),'utf8')).join('\n');
const quote=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
const statements=[];
const insert=(table,row)=>statements.push(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`);
const now='2026-09-28T12:00:00.000Z',tenant='notification-restore-fixture';
insert('agent_tenants',{id:tenant,name:'Synthetic notification recovery',created_at:now});
for(const [index,state] of ['pending','sending','accepted','uncertain','failed','cancelled'].entries()){
 const user=`fixture-${state}`,actor={tenant_id:tenant,user_id:user},notice=`notice-${state}`;
 insert('agent_memberships',{...actor,role:'owner'});
 insert('mayor_email_preferences',{...actor,enabled:state==='cancelled'?0:1,email:`${state}@example.invalid`,revision:3,updated_at:now});
 insert('mayor_notifications',{id:notice,...actor,dedupe_key:'calendar.connection',kind:'calendar_connection',state:index%2?'resolved':'open',created_at:now,updated_at:now,read_at:index%2?now:null,occurrence:2});
 insert('mayor_recurring_checks',{...actor,enabled:index%2,schedule_json:JSON.stringify({frequency:'weekdays',hour:9,minute:0,timeZone:'America/New_York'}),revision:4,next_run_at:index%2?now:null,due_local_date:'2026-09-28',lease_token:state==='sending'?'synthetic-check-lease':null,lease_until:state==='sending'?'2026-09-28T12:02:00.000Z':null,attempts:1,last_run_at:now,last_status:index%2?'ok':'failed',updated_at:now});
 insert('mayor_check_runs',{id:`run-${state}`,...actor,schedule_revision:4,due_at:now,attempt:1,status:index%2?'ok':'failed',checked_at:now});
 insert('mayor_email_outbox',{id:`mail-${state}`,...actor,preference_revision:3,recipient:`${state}@example.invalid`,fingerprint:`synthetic-${state}`,notifications_json:JSON.stringify([{id:notice,occurrence:2}]),state,attempts:1,next_attempt_at:now,lease_token:state==='sending'?'synthetic-email-lease':null,lease_until:state==='sending'?'2026-09-28T12:02:00.000Z':null,provider_id:state==='accepted'?'synthetic-provider-receipt':null,failure_code:state==='failed'?'synthetic_failure':null,created_at:now,updated_at:now});
}
if(process.argv.includes('--with-phone'))statements.push(readFileSync(new URL('./phone-fixture.sql',import.meta.url),'utf8'));
if(process.argv.includes('--with-business-agent'))statements.push(businessRecoveryFixtureSql());
const sql=schema+'\n'+statements.join('\n'),db=new DatabaseSync(':memory:');
try{
 db.exec(sql);
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Invalid fixture foreign keys.');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Invalid fixture integrity.');
 writeFileSync(resolve(output),sql,{flag:'wx'});
 console.log('Synthetic notification snapshot created: six delivery states, no real recipients.');
}finally{db.close();}
