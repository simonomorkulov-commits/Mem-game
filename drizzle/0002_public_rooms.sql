ALTER TABLE duel_rooms ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX duels_open ON duel_rooms(is_public, status, host_seen DESC);
