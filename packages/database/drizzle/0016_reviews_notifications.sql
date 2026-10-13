CREATE TYPE "public"."review_status" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"overall_rating" smallint NOT NULL,
	"vehicle_rating" smallint,
	"service_rating" smallint,
	"communication_rating" smallint,
	"comment" text,
	"provider_reply" text,
	"provider_replied_at" timestamp with time zone,
	"status" "review_status" DEFAULT 'published' NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_overall_rating_check" CHECK ("reviews"."overall_rating" between 1 and 5),
	CONSTRAINT "reviews_sub_ratings_check" CHECK (("reviews"."vehicle_rating" is null or "reviews"."vehicle_rating" between 1 and 5) and ("reviews"."service_rating" is null or "reviews"."service_rating" between 1 and 5) and ("reviews"."communication_rating" is null or "reviews"."communication_rating" between 1 and 5)),
	CONSTRAINT "reviews_hidden_state_check" CHECK (("reviews"."status" = 'hidden') = ("reviews"."hidden_at" is not null)),
	CONSTRAINT "reviews_reply_state_check" CHECK (("reviews"."provider_reply" is null) = ("reviews"."provider_replied_at" is null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text,
	"metadata" jsonb,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_vehicle_published_idx" ON "reviews" USING btree ("vehicle_id","created_at") WHERE "reviews"."status" = 'published';--> statement-breakpoint
CREATE INDEX "reviews_provider_published_idx" ON "reviews" USING btree ("provider_id","created_at") WHERE "reviews"."status" = 'published';--> statement-breakpoint
CREATE INDEX "reviews_customer_idx" ON "reviews" USING btree ("customer_user_id");--> statement-breakpoint
CREATE INDEX "reviews_status_created_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;