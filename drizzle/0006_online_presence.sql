CREATE TABLE online_presence (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, tab_id)
);
--> statement-breakpoint
CREATE INDEX online_presence_seen ON online_presence(seen_at, player_id);
