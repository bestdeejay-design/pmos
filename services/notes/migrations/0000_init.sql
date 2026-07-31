CREATE TABLE IF NOT EXISTS "note_links" (
	"note_id" uuid NOT NULL,
	"linked_note_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_links_note_id_linked_note_id_pk" PRIMARY KEY("note_id","linked_note_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"profile_ids" uuid[] DEFAULT '{}' NOT NULL,
	"linked_project_id" uuid,
	"linked_meeting_id" uuid,
	"linked_task_id" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
