ALTER TABLE "provider_locations" DROP CONSTRAINT "provider_locations_provider_id_provider_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_provider_id_provider_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_locations" ADD CONSTRAINT "provider_locations_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_provider_id_provider_profiles_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;