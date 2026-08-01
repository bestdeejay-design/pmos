CREATE UNIQUE INDEX IF NOT EXISTS "emails_account_message_unique" ON "emails" ("account_id", "message_id");
