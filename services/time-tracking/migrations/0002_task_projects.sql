CREATE TABLE IF NOT EXISTS "task_projects" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"task_title" text,
	"project_id" uuid,
	"project_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
