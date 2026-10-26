CREATE TABLE "account_resets" (
	"id" text PRIMARY KEY,
	"cutoff" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
