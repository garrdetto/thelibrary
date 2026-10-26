CREATE TABLE "lyric_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner" text NOT NULL,
	"original" text NOT NULL,
	"replacement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creations" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "creations" ADD COLUMN "tuning" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "creations" ADD COLUMN "research" jsonb;--> statement-breakpoint
CREATE INDEX "lyric_corrections_owner_date_idx" ON "lyric_corrections" ("owner","created_at");