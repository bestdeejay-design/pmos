CREATE TABLE IF NOT EXISTS "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_path" text,
	"size" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
