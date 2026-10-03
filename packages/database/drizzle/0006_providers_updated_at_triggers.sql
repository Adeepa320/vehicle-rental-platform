-- Custom migration: updated_at triggers for the Phase 3 tables.
-- provider_service_areas / provider_vehicle_categories / audit_events have no updated_at (append or replace semantics).
CREATE TRIGGER provider_applications_set_updated_at
  BEFORE UPDATE ON "provider_applications" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER provider_profiles_set_updated_at
  BEFORE UPDATE ON "provider_profiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
