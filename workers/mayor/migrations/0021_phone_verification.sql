CREATE TABLE mayor_phone_verifications (
 call_id TEXT PRIMARY KEY REFERENCES mayor_phone_calls(id),
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 connection_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('offered','sending','pending','checking','approved','declined','failed')),
 nonce TEXT NOT NULL,
 verification_sid TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX mayor_phone_verification_expiry ON mayor_phone_verifications(expires_at);
CREATE TRIGGER mayor_phone_verification_audit AFTER UPDATE OF state ON mayor_phone_verifications
 WHEN OLD.state!=NEW.state BEGIN
 INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.tenant_id,'phone:'||NEW.call_id,'phone.verification.'||NEW.state,NEW.call_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
