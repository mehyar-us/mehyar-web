CREATE TABLE mayor_customers (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 name TEXT NOT NULL,name_key TEXT NOT NULL,
 email TEXT,phone TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 confirmed_by TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(email IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX mayor_customers_tenant ON mayor_customers(tenant_id,name_key,id);
-- Shared family/business contact details are permitted; exact copies are not.
CREATE UNIQUE INDEX mayor_customers_exact ON mayor_customers(tenant_id,name_key,COALESCE(email,''),COALESCE(phone,''));
CREATE TRIGGER mayor_customer_created AFTER INSERT ON mayor_customers BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES('customer:'||NEW.id||':1',NEW.tenant_id,NEW.confirmed_by,'customer.created',NEW.id,NEW.created_at);
END;
CREATE TRIGGER mayor_customer_updated AFTER UPDATE ON mayor_customers BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES('customer:'||NEW.id||':'||NEW.revision,NEW.tenant_id,NEW.confirmed_by,'customer.updated',NEW.id,NEW.updated_at);
END;
