-- Custom migration: extensions and shared trigger function (docs/DATABASE_DESIGN.md §2).
-- postgis     geography types + GiST indexes for nearby search
-- btree_gist  exclusion constraints mixing equality and range overlap (vehicle_holds, Phase 4)
-- citext      case-insensitive email column (users, Phase 2)
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
-- Keeps updated_at current on every UPDATE; attached per table in later migrations.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
