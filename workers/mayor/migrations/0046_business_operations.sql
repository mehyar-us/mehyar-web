-- Local operations belong to a business. Customer links cannot cross tenants.
CREATE TABLE mayor_tasks (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 due_at TEXT,
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
 customer_id TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 completed_at TEXT,
 CHECK((status='completed' AND completed_at IS NOT NULL) OR (status='open' AND completed_at IS NULL)),
 FOREIGN KEY(customer_id,tenant_id) REFERENCES mayor_customers(id,tenant_id)
);
CREATE INDEX mayor_tasks_due ON mayor_tasks(tenant_id,status,due_at,id);
CREATE INDEX mayor_tasks_customer ON mayor_tasks(tenant_id,customer_id,status,due_at,id);
CREATE TRIGGER mayor_task_created AFTER INSERT ON mayor_tasks BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES('task:'||NEW.id||':1',NEW.tenant_id,NEW.created_by,'task.created',NEW.id,NEW.created_at);
END;
CREATE TRIGGER mayor_task_updated AFTER UPDATE ON mayor_tasks BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES('task:'||NEW.id||':'||NEW.revision,NEW.tenant_id,NEW.updated_by,
  CASE WHEN OLD.status='open' AND NEW.status='completed' THEN 'task.completed'
       WHEN OLD.status='completed' AND NEW.status='open' THEN 'task.reopened'
       ELSE 'task.updated' END,NEW.id,NEW.updated_at);
END;

-- Form confirmation references server-held data rather than a proposal supplied
-- by the client. Actor binding and expiry also survive browser refreshes.
CREATE TABLE mayor_customer_proposals (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 proposal_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed')),
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 confirmed_at TEXT,
 result_json TEXT,
 FOREIGN KEY(tenant_id,actor_id) REFERENCES agent_memberships(tenant_id,user_id)
);
CREATE INDEX mayor_customer_proposals_expiry ON mayor_customer_proposals(expires_at,state);

-- Virtual columns follow every existing booking/reschedule write automatically.
-- Numeric instants sort correctly even when the original JSON contains offsets.
ALTER TABLE mayor_appointments ADD COLUMN start_epoch INTEGER GENERATED ALWAYS AS (unixepoch(json_extract(input_json,'$.start'))) VIRTUAL;
ALTER TABLE mayor_appointments ADD COLUMN end_epoch INTEGER GENERATED ALWAYS AS (unixepoch(json_extract(input_json,'$.end'))) VIRTUAL;
CREATE INDEX mayor_appointments_agenda ON mayor_appointments(tenant_id,start_epoch,id);
CREATE INDEX mayor_appointments_active_agenda ON mayor_appointments(tenant_id,state,start_epoch,id);
