ALTER TABLE auth_provider_grants ADD COLUMN mailbox_control_revision INTEGER NOT NULL DEFAULT 1 CHECK(mailbox_control_revision>0);
