CREATE TYPE "public"."booking_status" AS ENUM('requested', 'accepted', 'confirmed', 'active', 'completed', 'declined', 'expired', 'cancelled_by_customer', 'cancelled_by_provider', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."decline_reason" AS ENUM('vehicle_unavailable', 'requirements_not_met', 'schedule_conflict', 'other', 'vehicle_no_longer_available');--> statement-breakpoint
CREATE TABLE "booking_drivers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"country_code" text,
	"licence_country" text NOT NULL,
	"licence_expires_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status",
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_idempotency_keys" (
	"customer_user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_idempotency_keys_customer_user_id_key_pk" PRIMARY KEY("customer_user_id","key")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" "booking_status" DEFAULT 'requested' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"rental_days" smallint NOT NULL,
	"customer_note" text,
	"provider_note" text,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"price_basis" text NOT NULL,
	"daily_rate" numeric(12, 2) NOT NULL,
	"weekly_rate" numeric(12, 2),
	"monthly_rate" numeric(12, 2),
	"subtotal_amount" numeric(12, 2) NOT NULL,
	"security_deposit_amount" numeric(12, 2) NOT NULL,
	"included_km_per_day" integer,
	"extra_km_rate" numeric(12, 2),
	"price_breakdown" jsonb NOT NULL,
	"pricing_fingerprint" text NOT NULL,
	"respond_by" timestamp with time zone NOT NULL,
	"confirm_by" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmation_source" text,
	"picked_up_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" "decline_reason",
	"decline_note" text,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_note" text,
	"no_show_at" timestamp with time zone,
	"no_show_note" text,
	"pickup_odometer_km" integer,
	"pickup_fuel_level" smallint,
	"pickup_note" text,
	"return_odometer_km" integer,
	"return_fuel_level" smallint,
	"return_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_period_check" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_rental_days_check" CHECK ("bookings"."rental_days" >= 1),
	CONSTRAINT "bookings_version_check" CHECK ("bookings"."version" >= 1),
	CONSTRAINT "bookings_amounts_check" CHECK ("bookings"."subtotal_amount" >= 0 and "bookings"."security_deposit_amount" >= 0 and "bookings"."daily_rate" > 0),
	CONSTRAINT "bookings_fuel_levels_check" CHECK (("bookings"."pickup_fuel_level" is null or "bookings"."pickup_fuel_level" between 0 and 8) and ("bookings"."return_fuel_level" is null or "bookings"."return_fuel_level" between 0 and 8))
);
--> statement-breakpoint
ALTER TABLE "booking_drivers" ADD CONSTRAINT "booking_drivers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_idempotency_keys" ADD CONSTRAINT "booking_idempotency_keys_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_idempotency_keys" ADD CONSTRAINT "booking_idempotency_keys_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_provider_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."provider_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_drivers_booking_id_key" ON "booking_drivers" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_provider_status_idx" ON "bookings" USING btree ("provider_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_vehicle_period_idx" ON "bookings" USING btree ("vehicle_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_respond_by_idx" ON "bookings" USING btree ("respond_by") WHERE "bookings"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "bookings_confirm_by_idx" ON "bookings" USING btree ("confirm_by") WHERE "bookings"."status" = 'accepted';--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_holds_booking_id_key" ON "vehicle_holds" USING btree ("booking_id") WHERE "vehicle_holds"."booking_id" is not null;