CREATE TABLE duel_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL,
  guest_id TEXT,
  pack INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  phase TEXT NOT NULL DEFAULT 'preparing',
  round_index INTEGER NOT NULL DEFAULT 0,
  ready_host INTEGER NOT NULL DEFAULT 0,
  ready_guest INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  ends_at INTEGER,
  reveal_at INTEGER,
  load_deadline INTEGER,
  host_seen INTEGER NOT NULL,
  guest_seen INTEGER,
  winner_id TEXT,
  finish_reason TEXT,
  recorded INTEGER NOT NULL DEFAULT 0,
  rematch_code TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX duels_host ON duel_rooms(host_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX duels_guest ON duel_rooms(guest_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE duel_seats (player_id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE duel_answers (
  room_id TEXT NOT NULL,
  round_index INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  option_id TEXT,
  correct INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY(room_id, round_index, player_id)
);
--> statement-breakpoint
CREATE TABLE duel_stats (
  player_id TEXT PRIMARY KEY NOT NULL,
  played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0
);
