-- Synthetic restore-drill records. Import ONLY into an isolated recovery database.
INSERT INTO agent_tenants(id,name,created_at) VALUES('recovery-fixture','Recovery test business','2026-09-22T00:00:00Z');
INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES('recovery-fixture','fixture-owner','owner');
INSERT INTO mayor_website_sources(id,tenant_id,requested_url,source_url,title,excerpt,content_hash,fetched_by,fetched_at)
VALUES('fixture-source','recovery-fixture','https://example.com/','https://example.com/','Recovery café','Owner''s café offers design & consulting.','fixture-hash','fixture-owner','2026-09-22T00:00:00Z');
INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at,provenance_json)
VALUES('recovery-fixture','profile','{"name":"Recovery café","services":["Design","Consulting"]}','owner_confirmed','fixture-owner','2026-09-22T00:00:00Z',3,'2026-09-22T00:00:00Z','{"services":{"kind":"website_owner_confirmed","sourceId":"fixture-source","url":"https://example.com/","quote":"Owner''s café offers design & consulting."}}');
INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,selected_number_id,selected_number,revision,verified_at,updated_at)
VALUES('fixture-phone','recovery-fixture','twilio','fixture-account','fixture-owner','fixture-not-a-real-credential','revoked',NULL,NULL,2,'2026-09-22T00:00:00Z','2026-09-22T00:00:00Z');
