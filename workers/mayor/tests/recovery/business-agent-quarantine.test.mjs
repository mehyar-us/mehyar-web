import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {businessRecoveryFixtureSql} from './business-recovery-fixture.mjs';

const migrations=new URL('../../migrations/',import.meta.url);
const quarantine=readFileSync(new URL('../../scripts/quarantine-restored-database.sql',import.meta.url),'utf8');
const drill=readFileSync(new URL('../../scripts/restore-drill.ps1',import.meta.url),'utf8');
const summarySql=drill.match(/\$summarySql=@'\r?\n([\s\S]*?)\r?\n'@/)?.[1];
assert.ok(summarySql,'The remote restore drill must have an executable verification summary.');
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL(name,migrations),'utf8'));
 db.exec(businessRecoveryFixtureSql());return db;
}
const rows=(db,table)=>db.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row}));
const without=(row,keys)=>Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));
function dump(db){return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()]));}

test('restored business schedules cannot run or finish captured work, while accepted records and usage survive',()=>{
 const db=fixture();
 try{
  const before=new Map(['mayor_business_routines','mayor_harness_configs','mayor_business_routine_runs','mayor_harness_runs','mayor_harness_proposals',
   'mayor_harness_state','mayor_harness_identity','mayor_harness_goals','mayor_harness_skills','mayor_harness_task_acceptances','mayor_tasks','mayor_billing_usage_periods','mayor_audit'].map(table=>[table,rows(db,table)]));
  db.exec(quarantine);
  for(const table of ['mayor_business_routines','mayor_harness_configs'])for(const old of before.get(table)){
   const actual=rows(db,table).find(row=>row.user_id===old.user_id);
   if(old.user_id==='restore-idle')assert.deepEqual(actual,old);
   else{
    assert.equal(actual.revision,old.revision+1);assert.equal(actual.enabled,0);
    for(const field of ['next_run_at','due_local_date','lease_token','lease_until'])assert.equal(actual[field],null);
    assert.deepEqual(without(actual,['revision','enabled','next_run_at','due_local_date','lease_token','lease_until','updated_at']),without(old,['revision','enabled','next_run_at','due_local_date','lease_token','lease_until','updated_at']));
   }
   assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table} WHERE enabled=1 AND next_run_at<='2099-01-01T10:00:00.000Z'`).get().count,0);
  }
  for(const table of ['mayor_business_routine_runs','mayor_harness_runs'])for(const old of before.get(table)){
   const actual=rows(db,table).find(row=>row.id===old.id);
   if(old.state!=='processing')assert.deepEqual(actual,old);
   else{
    assert.equal(actual.state,'failed');assert.equal(actual.lease_token,null);assert.equal(actual.lease_until,null);
    const changed=['state','lease_token','lease_until','updated_at',table==='mayor_harness_runs'?'report_json':'brief_json'];
    if(table==='mayor_harness_runs'){changed.push('error_code');assert.equal(actual.error_code,'restored_snapshot');assert.equal(actual.report_json,null);}
    else assert.equal(actual.brief_json,null);
    assert.deepEqual(without(actual,changed),without(old,changed));
    // The captured completion contract cannot match its old state/revision/lease.
    const configs=table==='mayor_harness_runs'?'mayor_harness_configs':'mayor_business_routines';
    assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table} r JOIN ${configs} c ON c.tenant_id=r.tenant_id AND c.user_id=r.user_id WHERE r.id=? AND r.state='processing' AND r.lease_token=? AND c.revision=? AND c.lease_token=?`).get(old.id,old.lease_token,old.config_revision,old.lease_token).count,0);
   }
  }
  for(const old of before.get('mayor_harness_proposals')){
   const actual=rows(db,'mayor_harness_proposals').find(row=>row.id===old.id);
   assert.deepEqual(actual,{...old,...(old.state==='pending'?{expires_at:'1970-01-01T00:00:00.000Z'}:{})});
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM mayor_harness_proposals WHERE state='pending' AND expires_at>'2026-10-03T10:00:00.000Z'").get().count,0);
  for(const table of ['mayor_harness_state','mayor_harness_identity','mayor_harness_goals','mayor_harness_skills','mayor_harness_task_acceptances','mayor_tasks','mayor_billing_usage_periods','mayor_audit'])assert.deepEqual(rows(db,table),before.get(table));
  assert.equal(db.prepare("SELECT count FROM mayor_billing_usage_periods WHERE kind='turn'").get().count,12);
  assert.equal(db.prepare("SELECT reply_attempt_counted FROM mayor_harness_runs WHERE id='restore-harness-active'").get().reply_attempt_counted,1);
  assert.equal(db.prepare("SELECT reply_attempt_counted FROM mayor_harness_runs WHERE id='restore-harness-manual'").get().reply_attempt_counted,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const after=dump(db);db.exec(quarantine);assert.equal(dump(db),after);
 }finally{db.close();}
});

test('restored audit work is held without polling jobs, changing paid receipts or losing completed report evidence',()=>{
 const db=fixture();
 try{
  const orders=rows(db,'mayor_audit_orders'),events=rows(db,'mayor_billing_events');db.exec(quarantine);
  for(const old of orders){
   const actual=rows(db,'mayor_audit_orders').find(row=>row.id===old.id),active=['awaiting_payment','queued','in_review'].includes(old.fulfillment_status);
   if(!active)assert.deepEqual(actual,old);
   else{
    assert.equal(actual.fulfillment_status,'needs_review');assert.equal(actual.analysis_error_code,'restored_database_quarantine');
    assert.equal(actual.analysis_next_attempt_at,0);
    for(const field of ['processing_token','lease_expires_at','analysis_token','analysis_lease_expires_at'])assert.equal(actual[field],null);
    const changed=['fulfillment_status','analysis_error_code','analysis_next_attempt_at','processing_token','lease_expires_at','analysis_token','analysis_lease_expires_at','updated_at'];
    assert.deepEqual(without(actual,changed),without(old,changed));
   }
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM mayor_audit_orders WHERE payment_status='paid' AND fulfillment_status IN ('queued','in_review')").get().count,0);
  // Verified late payment can queue only awaiting_payment, which the restore hold removes.
  assert.equal(db.prepare("SELECT count(*) AS count FROM mayor_audit_orders WHERE fulfillment_status='awaiting_payment'").get().count,0);
  for(const old of events){
   const actual=rows(db,'mayor_billing_events').find(row=>row.event_id===old.event_id);
   assert.deepEqual(actual,old.status==='processing'?{...old,status:'failed',error_code:'restored_snapshot',processing_token:null,lease_expires_at:null}:old);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const after=dump(db);db.exec(quarantine);assert.equal(dump(db),after);
 }finally{db.close();}
});

test('remote drill summary distinguishes quarantined business work and preserved receipts',()=>{
 const db=fixture();
 try{
  const before=db.prepare(summarySql).get();
  assert.equal(before.active_routine_configs,4);assert.equal(before.active_harness_configs,4);
  assert.equal(before.processing_routine_runs,3);assert.equal(before.processing_harness_runs,3);assert.equal(before.pending_harness_proposals,5);
  assert.equal(before.active_audit_orders,3);assert.equal(before.processing_billing_events,1);
  db.exec(quarantine);const after=db.prepare(summarySql).get();
  for(const field of ['active_routine_configs','active_harness_configs','processing_routine_runs','processing_harness_runs','pending_harness_proposals','active_audit_orders','audit_checkout_leases','processing_billing_events'])assert.equal(after[field],0,field);
  assert.equal(after.routine_revisions,before.routine_revisions+4);assert.equal(after.harness_revisions,before.harness_revisions+4);
  assert.equal(after.failed_routine_runs,before.failed_routine_runs+3);assert.equal(after.restored_harness_runs,before.restored_harness_runs+3);
  assert.equal(after.held_audit_orders,before.held_audit_orders+3);assert.equal(after.restored_billing_events,before.restored_billing_events+1);
  const mutable=new Set(['active_routine_configs','active_harness_configs','routine_revisions','harness_revisions','processing_routine_runs','processing_harness_runs','failed_routine_runs','restored_harness_runs','pending_harness_proposals','active_audit_orders','held_audit_orders','audit_checkout_leases','processing_billing_events','restored_billing_events']);
  for(const field of Object.keys(before))if(!mutable.has(field))assert.equal(after[field],before[field],field);
  db.exec(quarantine);assert.deepEqual(db.prepare(summarySql).get(),after);
 }finally{db.close();}
});
