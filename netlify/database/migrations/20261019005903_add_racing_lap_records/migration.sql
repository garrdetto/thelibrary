CREATE TABLE "racing_laps" (
	"id" text PRIMARY KEY,
	"owner" text NOT NULL,
	"username" text NOT NULL,
	"milliseconds" integer NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "racing_laps_time_idx" ON "racing_laps" ("milliseconds","created_at");