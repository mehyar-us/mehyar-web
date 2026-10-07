CREATE TABLE mayor_phone_registrations (
 customer_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 call_id TEXT NOT NULL UNIQUE REFERENCES mayor_phone_calls(id),
 policy_revision INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(customer_id,tenant_id) REFERENCES mayor_customers(id,tenant_id)
);
