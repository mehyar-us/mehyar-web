ALTER TABLE mayor_phone_calls ADD COLUMN caller_number TEXT;
CREATE TABLE mayor_callbacks (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 call_id TEXT NOT NULL UNIQUE REFERENCES mayor_phone_calls(id),
 number TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('scheduling','human_assistance')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','handled')),
 created_at TEXT NOT NULL,
 handled_at TEXT,
 handled_by TEXT
);
CREATE INDEX mayor_callbacks_pending ON mayor_callbacks(tenant_id,status,created_at,id);
CREATE TRIGGER mayor_callback_created AFTER INSERT ON mayor_callbacks BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES('callback-created:'||NEW.id,NEW.tenant_id,'phone:'||NEW.call_id,'callback.requested',NEW.id,NEW.created_at);
END;
CREATE TRIGGER mayor_callback_handled AFTER UPDATE OF status ON mayor_callbacks
 WHEN OLD.status='pending' AND NEW.status='handled' BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES('callback-handled:'||NEW.id,NEW.tenant_id,NEW.handled_by,'callback.handled',NEW.id,NEW.handled_at);
END;
