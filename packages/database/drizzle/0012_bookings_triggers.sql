-- Phase 6 booking lifecycle (DATABASE_DESIGN §6.7): keep bookings.updated_at current and make the
-- booking timeline append-only. drizzle-kit cannot express triggers, hence this custom migration.
CREATE TRIGGER bookings_set_updated_at BEFORE UPDATE ON "bookings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE OR REPLACE FUNCTION booking_events_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''booking_events is append-only (id %)'', OLD.id USING ERRCODE = ''restrict_violation''; END;';--> statement-breakpoint
CREATE TRIGGER booking_events_append_only BEFORE UPDATE ON "booking_events" FOR EACH ROW EXECUTE FUNCTION booking_events_forbid_update();
