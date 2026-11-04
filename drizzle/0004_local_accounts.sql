CREATE TABLE local_accounts (
  player_id TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'guest',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE player_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX player_session_owner ON player_sessions(player_id);
--> statement-breakpoint
CREATE TABLE account_rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
