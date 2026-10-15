-- Phase 9 admin operations (DATABASE_DESIGN §6.3, §6.5, §6.9, §12): keep updated_at current on the
-- new mutable tables and make the dispute thread append-only. drizzle-kit cannot express triggers.
CREATE TRIGGER verification_documents_set_updated_at BEFORE UPDATE ON "verification_documents" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER disputes_set_updated_at BEFORE UPDATE ON "disputes" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE OR REPLACE FUNCTION dispute_messages_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS 'BEGIN IF NEW.body IS DISTINCT FROM OLD.body OR NEW.dispute_id IS DISTINCT FROM OLD.dispute_id OR NEW.author_role IS DISTINCT FROM OLD.author_role OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION ''dispute_messages is append-only (id %)'', OLD.id USING ERRCODE = ''restrict_violation''; END IF; RETURN NEW; END;';--> statement-breakpoint
CREATE TRIGGER dispute_messages_append_only BEFORE UPDATE ON "dispute_messages" FOR EACH ROW EXECUTE FUNCTION dispute_messages_forbid_update();
