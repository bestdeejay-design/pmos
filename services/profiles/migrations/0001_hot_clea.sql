ALTER TABLE "profiles" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;