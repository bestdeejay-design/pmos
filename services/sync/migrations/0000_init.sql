CREATE TABLE IF NOT EXISTS "sync_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path" text NOT NULL,
	"auto_import" boolean DEFAULT false NOT NULL,
	"auto_export" boolean DEFAULT false NOT NULL,
	"profile_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
