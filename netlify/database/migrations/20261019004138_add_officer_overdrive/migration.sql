CREATE TABLE "racing_profiles" (
	"owner" text PRIMARY KEY,
	"scheme" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "racing_tickets" (
	"hash" text PRIMARY KEY,
	"owner" text NOT NULL,
	"username" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
