CREATE TABLE IF NOT EXISTS "scanned_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"content_md" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scanned_files_folder_path_unique" UNIQUE("folder_id", "relative_path")
);
