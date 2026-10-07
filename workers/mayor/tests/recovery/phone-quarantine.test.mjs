import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const migrations=new URL('../../migrations/',import.meta.url);
test('restored phone authorization cannot resume and provider outcomes are not fabricated',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL(name,migrations),'utf8'));
  db.exec(readFileSync(new URL('./phone-fixture.sql',import.meta.url),'utf8'));
  const sql=readFileSync(new URL('../../scripts/quarantine-restored-database.sql',import.meta.url),'utf8');db.exec(sql);
  assert.equal(db.prepare('SELECT status FROM mayor_phone_connections').get().status,'revoked');
  assert.equal(db.prepare('SELECT revision FROM mayor_phone_connections').get().revision,2);
  assert.equal(db.prepare('SELECT state FROM mayor_phone_calls').get().state,'ended');
  assert.equal(db.prepare('SELECT state FROM mayor_phone_verifications').get().state,'failed');
  assert.equal(db.prepare('SELECT expires_at FROM mayor_telnyx_stream_grants').get().expires_at,0);
  assert.equal(db.prepare('SELECT state FROM mayor_telnyx_commands').get().state,'blocked');
  assert.equal(db.prepare('SELECT state FROM mayor_telnyx_terminations').get().state,'uncertain');
  assert.equal(db.prepare('SELECT state FROM mayor_telnyx_recovery').get().state,'review');
  assert.equal(db.prepare('SELECT count(*) n FROM mayor_telnyx_ended_calls').get().n,0);
  const dump=()=>JSON.stringify(['mayor_phone_connections','mayor_phone_calls','mayor_phone_verifications','mayor_telnyx_commands','mayor_telnyx_terminations','mayor_telnyx_recovery','mayor_audit'].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  const after=dump();db.exec(sql);assert.equal(dump(),after);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
