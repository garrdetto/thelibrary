CREATE TABLE "pool_practice_records" (
	"id" uuid PRIMARY KEY,
	"owner" text NOT NULL,
	"username" text NOT NULL,
	"mode" text NOT NULL,
	"milliseconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pool_practice_records_mode_time_idx" ON "pool_practice_records" ("mode","milliseconds","created_at");