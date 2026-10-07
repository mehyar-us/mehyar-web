INSERT INTO agent_tenants(id,name,created_at) VALUES('t','fixture','now');
   INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at) VALUES('c','t','telnyx','account','owner','encrypted-fixture','authorized','now','now');
   INSERT INTO mayor_phone_calls(id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at) VALUES('call','t','account','sid',1,'streaming','2099','2099','now');
   INSERT INTO mayor_phone_verifications(call_id,tenant_id,connection_revision,state,nonce,expires_at,created_at) VALUES('call','t',1,'approved','nonce','2099','now');
   INSERT INTO mayor_telnyx_admissions(id,event_id,tenant_id,connection_id,connection_revision,call_control_id,payload_hash,created_at) VALUES('a','event','t','c',1,'control','hash','now');
   INSERT INTO mayor_telnyx_stream_grants(admission_id,token_hash,expires_at) VALUES('a','hash',9999999999999);
   INSERT INTO mayor_telnyx_terminations VALUES('a','command','dispatching','now');
   INSERT INTO mayor_telnyx_recovery VALUES('a',1,'pending',9999999999999,'lease',9999999999999,'alive');