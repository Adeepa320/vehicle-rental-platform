CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('advance');--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid,
	"booking_id" uuid,
	"gateway" text NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"order_id" text,
	"gateway_payment_id" text,
	"status_code" text,
	"signature_valid" boolean,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"type" "payment_type" DEFAULT 'advance' NOT NULL,
	"gateway" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'LKR' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"order_id" text NOT NULL,
	"gateway_payment_id" text,
	"gateway_status_code" text,
	"gateway_method" text,
	"failure_reason" text,
	"anomaly" text,
	"requires_manual_resolution" boolean DEFAULT false NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"refund_due_amount" numeric(12, 2),
	"refunded_amount" numeric(12, 2),
	"refund_reference" text,
	"refund_reason" text,
	"refunded_by" uuid,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_refund_amounts_check" CHECK (("payments"."refund_due_amount" is null or "payments"."refund_due_amount" >= 0) and ("payments"."refunded_amount" is null or ("payments"."refunded_amount" >= 0 and "payments"."refunded_amount" <= "payments"."amount")))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "advance_percentage" numeric(5, 2) DEFAULT '10.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "advance_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "balance_due_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_by_users_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_events_booking_idx" ON "payment_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "payments" USING btree ("gateway","gateway_payment_id") WHERE "payments"."gateway_payment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_pending_advance_key" ON "payments" USING btree ("booking_id") WHERE "payments"."type" = 'advance' and "payments"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_paid_advance_key" ON "payments" USING btree ("booking_id") WHERE "payments"."type" = 'advance' and "payments"."status" in ('paid', 'refunded') and "payments"."anomaly" is null;--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_manual_resolution_idx" ON "payments" USING btree ("created_at") WHERE "payments"."requires_manual_resolution" = true;