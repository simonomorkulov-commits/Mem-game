ALTER TABLE match_rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';
--> statement-breakpoint
ALTER TABLE match_answers ADD COLUMN elapsed_ms INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE match_answers ADD COLUMN speed_bonus INTEGER NOT NULL DEFAULT 0;
