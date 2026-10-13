-- rot136: email capture on the public /sales page. One row per email;
-- submissions land in this table and nowhere else. Pre-account leads for
-- The Mayor itself, so no tenant column. Data kept minimal on purpose:
-- email, the page source, and the capture time.
CREATE TABLE IF NOT EXISTS mayor_sales_leads(
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 source TEXT NOT NULL DEFAULT 'sales',
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mayor_sales_leads_created ON mayor_sales_leads(created_at);
