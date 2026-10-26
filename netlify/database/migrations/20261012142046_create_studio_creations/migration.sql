CREATE TABLE "creations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"content" text NOT NULL,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"settings" jsonb,
	"image_mime" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "creations_owner_date_idx" ON "creations" ("owner","created_at");