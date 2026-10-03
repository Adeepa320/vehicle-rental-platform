CREATE TYPE "public"."provider_application_status" AS ENUM('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('individual', 'registered_business');--> statement-breakpoint
CREATE TABLE "provider_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "provider_application_status" DEFAULT 'draft' NOT NULL,
	"display_name" text,
	"provider_type" "provider_type",
	"contact_name" text,
	"phone_e164" text,
	"whatsapp_e164" text,
	"address_text" text,
	"district_id" text,
	"primary_place_id" uuid,
	"service_area_place_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"description" text,
	"years_operating" smallint,
	"vehicle_category_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"fleet_size_estimate" smallint,
	"offers_delivery" boolean DEFAULT false NOT NULL,
	"offers_airport_transfer" boolean DEFAULT false NOT NULL,
	"website_url" text,
	"applicant_notes" text,
	"agreement_accepted_at" timestamp with time zone,
	"agreement_version" text,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"changes_requested_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_reason" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	"contact_name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"whatsapp_e164" text,
	"description" text,
	"address_text" text NOT NULL,
	"district_id" text NOT NULL,
	"primary_place_id" uuid NOT NULL,
	"years_operating" smallint,
	"fleet_size_estimate" smallint,
	"offers_delivery" boolean DEFAULT false NOT NULL,
	"offers_airport_transfer" boolean DEFAULT false NOT NULL,
	"website_url" text,
	"status" "provider_status" DEFAULT 'active' NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approved_by" uuid,
	"suspended_at" timestamp with time zone,
	"suspended_by" uuid,
	"suspension_reason" text,
	"reactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_service_areas" (
	"provider_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	CONSTRAINT "provider_service_areas_provider_id_place_id_pk" PRIMARY KEY("provider_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "provider_vehicle_categories" (
	"provider_id" uuid NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "provider_vehicle_categories_provider_id_category_id_pk" PRIMARY KEY("provider_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"reason" text,
	"metadata" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_primary_place_id_places_id_fk" FOREIGN KEY ("primary_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_applications" ADD CONSTRAINT "provider_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_application_id_provider_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."provider_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_primary_place_id_places_id_fk" FOREIGN KEY ("primary_place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_suspended_by_users_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_vehicle_categories" ADD CONSTRAINT "provider_vehicle_categories_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_vehicle_categories" ADD CONSTRAINT "provider_vehicle_categories_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_applications_user_id_key" ON "provider_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_applications_status_idx" ON "provider_applications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_profiles_user_id_key" ON "provider_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_profiles_application_id_key" ON "provider_profiles" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_profiles_slug_key" ON "provider_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "provider_profiles_status_idx" ON "provider_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_profiles_district_id_idx" ON "provider_profiles" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "provider_profiles_primary_place_id_idx" ON "provider_profiles" USING btree ("primary_place_id");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action","created_at");