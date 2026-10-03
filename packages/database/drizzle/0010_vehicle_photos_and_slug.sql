CREATE TABLE "vehicle_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"public_prefix" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_photos_vehicle_order_idx" ON "vehicle_photos" USING btree ("vehicle_id","sort_order") WHERE "vehicle_photos"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_slug_key" ON "vehicles" USING btree ("slug") WHERE "vehicles"."slug" is not null;