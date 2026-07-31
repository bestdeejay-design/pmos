CREATE TABLE IF NOT EXISTS "file_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"owner_type" text,
	"owner_id" uuid,
	"storage_path" text NOT NULL,
	"profile_ids" uuid[] DEFAULT '{}' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
