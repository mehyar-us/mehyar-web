CREATE TABLE mayor_customer_phone_access (
 customer_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 customer_revision INTEGER NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 granted_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 FOREIGN KEY(customer_id,tenant_id) REFERENCES mayor_customers(id,tenant_id)
);
