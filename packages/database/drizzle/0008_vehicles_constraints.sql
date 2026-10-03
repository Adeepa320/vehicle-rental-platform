-- Overlapping holds per vehicle are impossible at the database level (DATABASE_DESIGN §6.6, TECH_DECISIONS D14).
-- drizzle-kit cannot express EXCLUDE constraints or triggers, hence this custom migration.
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_no_overlap" EXCLUDE USING gist ("vehicle_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);--> statement-breakpoint
CREATE TRIGGER provider_locations_set_updated_at BEFORE UPDATE ON "provider_locations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON "vehicles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
