-- Phase 8 reviews (DATABASE_DESIGN §6.9): keep updated_at current on edits and replies.
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON "reviews" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
