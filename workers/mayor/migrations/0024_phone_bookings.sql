ALTER TABLE mayor_customer_phone_access ADD COLUMN allow_bookings INTEGER NOT NULL DEFAULT 0 CHECK(allow_bookings IN (0,1));
CREATE TABLE mayor_phone_bookings (
 booking_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 call_id TEXT NOT NULL REFERENCES mayor_phone_calls(id),
 customer_id TEXT NOT NULL,
 scope_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(booking_id,tenant_id) REFERENCES mayor_appointment_jobs(id,tenant_id),
 FOREIGN KEY(customer_id,tenant_id) REFERENCES mayor_customers(id,tenant_id)
);
