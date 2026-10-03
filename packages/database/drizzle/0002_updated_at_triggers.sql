-- Custom migration: updated_at triggers for the Phase 1 tables.
-- Every new table with an updated_at column gets the same trigger in its own migration.
CREATE TRIGGER districts_set_updated_at
  BEFORE UPDATE ON "districts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER places_set_updated_at
  BEFORE UPDATE ON "places" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER vehicle_categories_set_updated_at
  BEFORE UPDATE ON "vehicle_categories" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER platform_settings_set_updated_at
  BEFORE UPDATE ON "platform_settings" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
