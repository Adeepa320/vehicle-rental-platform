-- Phase 10 production readiness (TECH_DECISIONS D67, D69): keep updated_at current on the new
-- mutable tables. drizzle-kit cannot express triggers; set_updated_at() exists since 0004.
CREATE TRIGGER user_mfa_set_updated_at BEFORE UPDATE ON "user_mfa" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER privacy_requests_set_updated_at BEFORE UPDATE ON "privacy_requests" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
