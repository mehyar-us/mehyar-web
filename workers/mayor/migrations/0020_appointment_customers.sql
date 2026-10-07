CREATE UNIQUE INDEX mayor_customer_tenant_identity ON mayor_customers(id,tenant_id);
CREATE UNIQUE INDEX mayor_job_tenant_identity ON mayor_appointment_jobs(id,tenant_id);
CREATE TABLE mayor_appointment_customers (
 booking_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 customer_revision INTEGER NOT NULL,
 FOREIGN KEY(booking_id,tenant_id) REFERENCES mayor_appointment_jobs(id,tenant_id),
 FOREIGN KEY(customer_id,tenant_id) REFERENCES mayor_customers(id,tenant_id)
);
CREATE INDEX mayor_customer_appointments ON mayor_appointment_customers(tenant_id,customer_id,booking_id);
ALTER TABLE mayor_appointment_changes ADD COLUMN customer_revision INTEGER;
