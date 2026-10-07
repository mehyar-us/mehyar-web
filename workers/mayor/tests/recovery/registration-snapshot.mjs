// Synthetic-only fixture. No network, credentials or production database reads.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const output=process.argv[2];if(!output)throw new Error('Supply an output SQL file path.');
const migrations=fileURLToPath(new URL('../../migrations/',import.meta.url));
const schema=readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort().map(name=>readFileSync(join(migrations,name),'utf8')).join('\n');
const fixture=`
INSERT INTO agent_tenants(id,name,created_at) VALUES('restore-fixture','Synthetic restore business','2026-09-26T00:00:00.000Z');
INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES('restore-fixture','fixture-owner','owner');
INSERT INTO mayor_phone_registration_policy(tenant_id,enabled,revision,granted_by,updated_at) VALUES('restore-fixture',1,3,'fixture-owner','2026-09-26T00:00:00.000Z');
INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number) VALUES('fixture-call','restore-fixture','synthetic-account','synthetic-call',2,'ended','2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','+12025550123');
INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) VALUES('fixture-call','restore-fixture',2,'approved','synthetic-nonce','2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z');
INSERT INTO mayor_customers(id,tenant_id,name,name_key,phone,confirmed_by,created_at,updated_at) VALUES('fixture-customer','restore-fixture','Synthetic Caller','synthetic caller','+12025550123','phone:fixture-call','2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z');
INSERT INTO mayor_phone_registrations(customer_id,tenant_id,call_id,policy_revision,created_at) VALUES('fixture-customer','restore-fixture','fixture-call',3,'2026-09-26T00:00:00.000Z');
INSERT INTO mayor_customer_phone_access(customer_id,tenant_id,customer_revision,enabled,allow_changes,allow_bookings,granted_by,updated_at) VALUES('fixture-customer','restore-fixture',1,1,1,1,'fixture-owner','2026-09-26T00:00:00.000Z');
`;
const sql=schema+'\n'+fixture,db=new DatabaseSync(':memory:');
try{
 db.exec(sql);
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Fixture foreign keys are invalid.');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Fixture integrity check failed.');
 writeFileSync(resolve(output),sql,{flag:'wx'});
 console.log('Synthetic registration snapshot created; no production data included.');
}finally{db.close();}
