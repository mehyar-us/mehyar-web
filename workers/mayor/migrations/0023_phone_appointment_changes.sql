ALTER TABLE mayor_customer_phone_access ADD COLUMN allow_changes INTEGER NOT NULL DEFAULT 0 CHECK(allow_changes IN (0,1));
CREATE UNIQUE INDEX mayor_change_tenant_identity ON mayor_appointment_changes(id,tenant_id);
CREATE TABLE mayor_phone_changes (
 change_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 call_id TEXT NOT NULL REFERENCES mayor_phone_calls(id),
 customer_id TEXT NOT NULL,
 scope_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(change_id,tenant_id) REFERENCES mayor_appointment_changes(id,tenant_id),
 FOREIGN KEY(customer_id,tenant_id) REFERENCES mayor_customers(id,tenant_id)
);
