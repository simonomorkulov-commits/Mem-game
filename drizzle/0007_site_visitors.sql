CREATE TABLE visitor_presence (
  visitor_hash TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (visitor_hash, tab_id)
);
--> statement-breakpoint
CREATE INDEX visitor_presence_seen ON visitor_presence(seen_at, player_id, visitor_hash);
