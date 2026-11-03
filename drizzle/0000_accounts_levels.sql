CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL UNIQUE,
  best_score INTEGER NOT NULL DEFAULT 0,
  furthest_room INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX players_ranking ON players(best_score DESC, furthest_room DESC, nickname_key);
--> statement-breakpoint
CREATE TABLE game_levels (
  id TEXT PRIMARY KEY NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  target_id TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'neon',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX levels_order ON game_levels(active, position);
--> statement-breakpoint
CREATE TABLE game_config (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE game_runs (
  id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT,
  token_hash TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  round_index INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  lives INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
  recorded INTEGER NOT NULL DEFAULT 0,
  last_request_id TEXT,
  last_result TEXT,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX runs_player ON game_runs(player_id, status, started_at DESC);
