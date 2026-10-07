import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {it,expect} from 'vitest';
it('preserves notification identity, read state and occurrence while adding phone alerts',async()=>{
 const db=(env as any).MIGRATION_TEST_DB as D1Database,migrations=(env as any).TEST_MIGRATIONS;
 await applyD1Migrations(db,migrations.filter((m:any)=>!m.name.startsWith('0044')));
 await db.prepare("INSERT INTO agent_tenants(id,name,created_at) VALUES('tenant','Fixture','2026-01-01')").run();
 await db.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES('tenant','user','owner')").run();
 await db.prepare("INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at,read_at,occurrence) VALUES('notice','tenant','user','calendar_connection','calendar_connection','open','2026-01-01','2026-01-02','2026-01-02',3)").run();
 const before=await db.prepare('SELECT * FROM mayor_notifications').all();
 await applyD1Migrations(db,migrations);
 expect((await db.prepare('SELECT * FROM mayor_notifications').all()).results).toEqual(before.results);
 await db.prepare("UPDATE mayor_notifications SET kind='phone_call_review' WHERE id='notice'").run();
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
