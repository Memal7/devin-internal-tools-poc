-- Defense in depth: the database itself rejects UPDATE and DELETE on audit_events.
-- PostgreSQL equivalent (when migrating providers): a BEFORE UPDATE OR DELETE
-- trigger on audit_events that raises an exception, plus REVOKE UPDATE, DELETE.
CREATE TRIGGER "audit_events_no_update"
BEFORE UPDATE ON "audit_events"
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TRIGGER "audit_events_no_delete"
BEFORE DELETE ON "audit_events"
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;
