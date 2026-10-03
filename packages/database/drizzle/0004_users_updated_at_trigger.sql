-- Custom migration: keep users.updated_at current (refresh_tokens / one_time_tokens are append-style and have no updated_at).
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
