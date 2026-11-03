CREATE TABLE match_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pack INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  parent_id TEXT UNIQUE,
  rematch_id TEXT,
  status TEXT NOT NULL DEFAULT 'lobby',
  phase TEXT NOT NULL DEFAULT 'preparing',
  round_index INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  ends_at INTEGER,
  reveal_at INTEGER,
  load_deadline INTEGER,
  winner_ids TEXT NOT NULL DEFAULT '[]',
  finish_reason TEXT,
  recorded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX match_room_menu ON match_rooms(status, created_at DESC);
--> statement-breakpoint
CREATE TABLE match_members (
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'joined',
  ready INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  joined_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY(room_id, player_id),
  UNIQUE(room_id, slot)
);
--> statement-breakpoint
CREATE TABLE match_seats (player_id TEXT PRIMARY KEY NOT NULL, room_id TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE match_answers (
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
CREATE TABLE match_password_attempts (
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(room_id, player_id)
);
