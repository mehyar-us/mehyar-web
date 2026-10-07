import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('quarantines restored notification work without losing receipts or allowing replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'mayor-quarantine-'));
 const db=new DatabaseSync(':memory:');
 try{
  const path=join(dir,'synthetic.sql');
  execFileSync(process.execPath,[fileURLToPath(new URL('./notification-snapshot.mjs',import.meta.url)),path]);
  db.exec(readFileSync(path,'utf8'));
  const sql=readFileSync(new URL('../../scripts/quarantine-restored-database.sql',import.meta.url),'utf8');
  const before=db.prepare('SELECT * FROM mayor_email_outbox ORDER BY id').all();
  db.exec(sql);
  const after=db.prepare('SELECT * FROM mayor_email_outbox ORDER BY id').all();
  assert.equal(after.length,6);
  for(const old of before){
   const row=after.find(r=>r.id===old.id);
   if(['pending','sending'].includes(old.state)){
    assert.equal(row.state,'uncertain');assert.equal(row.failure_code,'restored_snapshot');
    assert.equal(row.lease_token,null);assert.equal(row.lease_until,null);
   }else assert.deepEqual(row,old);
   assert.equal(row.fingerprint,old.fingerprint);assert.equal(row.notifications_json,old.notifications_json);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM mayor_email_preferences WHERE enabled=1').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mayor_recurring_checks WHERE enabled=1 OR next_run_at IS NOT NULL OR lease_token IS NOT NULL').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mayor_check_runs').get().n,6);
  assert.equal(db.prepare('SELECT count(*) AS n FROM mayor_notifications').get().n,6);
  assert.equal(db.prepare("SELECT revision FROM mayor_email_preferences WHERE user_id='fixture-pending'").get().revision,4);
  assert.equal(db.prepare("SELECT revision FROM mayor_recurring_checks WHERE user_id='fixture-sending'").get().revision,5);
  const snapshot=JSON.stringify(['mayor_email_outbox','mayor_email_preferences','mayor_recurring_checks'].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  db.exec(sql);
  assert.equal(JSON.stringify(['mayor_email_outbox','mayor_email_preferences','mayor_recurring_checks'].map(t=>db.prepare(`SELECT * FROM ${t}`).all())),snapshot);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{
  db.close();
  // Only this test's freshly created, exact temporary directory is removed.
  assert.ok(dir.startsWith(join(tmpdir(),'mayor-quarantine-')));
  rmSync(dir,{recursive:true,force:true});
 }
});
