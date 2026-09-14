-- 0026_audit_leads_contact.sql — optional phone + ZIP capture on the free audit form.

ALTER TABLE audit_leads ADD COLUMN phone TEXT;
ALTER TABLE audit_leads ADD COLUMN zip TEXT;
