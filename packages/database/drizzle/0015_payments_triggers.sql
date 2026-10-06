-- Phase 7 payments (DATABASE_DESIGN §6.8): updated_at maintenance, an append-only payment audit trail
-- and the money-split backfill for bookings created before advance_amount existed.
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE OR REPLACE FUNCTION payment_events_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS '
BEGIN
  IF NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
     AND (to_jsonb(NEW) - ''actor_user_id'') = (to_jsonb(OLD) - ''actor_user_id'') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION ''payment_events is append-only (id %)'', OLD.id USING ERRCODE = ''restrict_violation'';
END;';--> statement-breakpoint
CREATE TRIGGER payment_events_append_only BEFORE UPDATE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION payment_events_forbid_update();--> statement-breakpoint
-- Existing bookings predate the split: snapshot 10% (the seeded advance_percentage) of the subtotal.
UPDATE "bookings" SET "advance_percentage" = 10.00, "advance_amount" = round("subtotal_amount" * 0.10, 2), "balance_due_amount" = "subtotal_amount" - round("subtotal_amount" * 0.10, 2) WHERE "advance_amount" = 0 AND "balance_due_amount" = 0;
