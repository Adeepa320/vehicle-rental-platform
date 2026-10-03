-- Phase 6 follow-up: the append-only guard on booking_events must still allow the ON DELETE SET NULL
-- cascade of actor_user_id when a user account is erased (that cascade is an UPDATE). Any other change
-- is still refused. Replaces the function created in 0012_bookings_triggers.
CREATE OR REPLACE FUNCTION booking_events_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS '
BEGIN
  IF NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
     AND (to_jsonb(NEW) - ''actor_user_id'') = (to_jsonb(OLD) - ''actor_user_id'') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION ''booking_events is append-only (id %)'', OLD.id USING ERRCODE = ''restrict_violation'';
END;';
