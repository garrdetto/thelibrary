ALTER TABLE "racing_laps" ADD COLUMN "track" text DEFAULT 'circuit' NOT NULL;--> statement-breakpoint
CREATE INDEX "racing_laps_track_mode_idx" ON "racing_laps" ("track","mode","milliseconds");