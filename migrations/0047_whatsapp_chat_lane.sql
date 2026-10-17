-- 0047: WhatsApp chat lane (Cloud API) on the unified social inbox.
-- social_inbox_log was originally created by hand (see router.js header);
-- this makes the table canonical AND adds the two columns the WhatsApp
-- lane needs. Run once against LEADS_DB.
--   review: 1 = a human must pick this row up (off-script question, media
--           inbound, Moonroom human step, failed delivery status).
--   detail: small JSON (step / send outcome / inbound text excerpt).

CREATE TABLE IF NOT EXISTS social_inbox_log (
  ref_id TEXT PRIMARY KEY,
  account TEXT,
  kind TEXT,
  author TEXT,
  product_id TEXT,
  replied_at TEXT
);

ALTER TABLE social_inbox_log ADD COLUMN review INTEGER DEFAULT 0;
ALTER TABLE social_inbox_log ADD COLUMN detail TEXT;
