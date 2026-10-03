CREATE TYPE "public"."block_reason" AS ENUM('maintenance', 'provider_unavailable', 'rented_offline', 'reserved_offline', 'other');--> statement-breakpoint
CREATE TYPE "public"."fuel_policy" AS ENUM('full_to_full', 'same_to_same', 'included');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('petrol', 'diesel', 'hybrid', 'electric');--> statement-breakpoint
CREATE TYPE "public"."hold_kind" AS ENUM('booking', 'block');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('manual', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'inactive', 'suspended');--> statement-breakpoint
CREATE TABLE "provider_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"district_id" text NOT NULL,
	"place_id" uuid NOT NULL,
	"address_text" text NOT NULL,
	"geom" geography(Point,4326),
	"pickup_instructions" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" "hold_kind" NOT NULL,
	"booking_id" uuid,
	"block_reason" "block_reason",
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_holds_period_check" CHECK ("vehicle_holds"."ends_at" > "vehicle_holds"."starts_at"),
	CONSTRAINT "vehicle_holds_kind_consistency" CHECK (("vehicle_holds"."kind" = 'booking') = ("vehicle_holds"."booking_id" is not null) and ("vehicle_holds"."kind" = 'block') = ("vehicle_holds"."block_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"location_id" uuid,
	"category_id" text NOT NULL,
	"status" "vehicle_status" DEFAULT 'draft' NOT NULL,
	"title" text,
	"internal_name" text,
	"make" text,
	"model" text,
	"model_year" smallint,
	"transmission" "transmission",
	"fuel_type" "fuel_type",
	"seats" smallint,
	"doors" smallint,
	"luggage_capacity" smallint,
	"engine_cc" smallint,
	"has_ac" boolean DEFAULT false NOT NULL,
	"color" text,
	"registration_number" text,
	"description" text,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"daily_rate" numeric(12, 2),
	"weekly_rate" numeric(12, 2),
	"monthly_rate" numeric(12, 2),
	"security_deposit" numeric(12, 2),
	"included_km_per_day" integer,
	"extra_km_rate" numeric(12, 2),
	"min_rental_days" smallint DEFAULT 1 NOT NULL,
	"max_rental_days" smallint,
	"min_renter_age" smallint,
	"min_licence_years" smallint,
	"fuel_policy" "fuel_policy",
	"delivery_available" boolean DEFAULT false NOT NULL,
	"delivery_fee" numeric(12, 2),
	"pickup_notes" text,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"changes_requested_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_reason" text,
	"suspension_reason" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vehicles_daily_rate_positive" CHECK ("vehicles"."daily_rate" is null or "vehicles"."daily_rate" > 0),
	CONSTRAINT "vehicles_min_rental_days_check" CHECK ("vehicles"."min_rental_days" >= 1)
);
--> statement-breakpoint
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_holds" ADD CONSTRAINT "vehicle_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_location_id_provider_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."provider_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_locations_provider_id_idx" ON "provider_locations" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "provider_locations_place_id_idx" ON "provider_locations" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_locations_one_primary_key" ON "provider_locations" USING btree ("provider_id") WHERE "provider_locations"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "provider_locations_geom_gix" ON "provider_locations" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "vehicle_holds_vehicle_period_idx" ON "vehicle_holds" USING btree ("vehicle_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "vehicles_provider_id_idx" ON "vehicles" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "vehicles_location_id_idx" ON "vehicles" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "vehicles_category_id_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_provider_registration_key" ON "vehicles" USING btree ("provider_id","registration_number") WHERE "vehicles"."deleted_at" is null;