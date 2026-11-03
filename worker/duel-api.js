const DUEL_ROUND_MS = 45000, DUEL_COUNTDOWN_MS = 3500, DUEL_REVEAL_MS = 4500, DUEL_AWAY_MS = 90000;
const duelJSON = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function duelFail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const duelRow = (env, code) => env.DB.prepare('SELECT * FROM duel_rooms WHERE code = ?').bind(code).first();
const duelAnswers = (env, id) => env.DB.prepare('SELECT * FROM duel_answers WHERE room_id = ? ORDER BY round_index').bind(id).all().then(r => r.results);
function duelCode() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint8Array(6))].map(n => alphabet[n % alphabet.length]).join(''); }
function duelCompare(room, answers) {
  const sum = id => answers.filter(a => a.player_id === id).reduce((n, a) => n + a.score, 0);
  return sum(room.host_id) === sum(room.guest_id) ? null : sum(room.host_id) > sum(room.guest_id) ? room.host_id : room.guest_id;
}
async function duelRecord(env, room) {
  if (room.status !== 'finished' || room.recorded || !room.guest_id) return;
  const statements = [room.host_id, room.guest_id].map(id => env.DB.prepare("INSERT INTO duel_stats (player_id, played, wins, draws) SELECT ?, 1, CASE WHEN winner_id = ? THEN 1 ELSE 0 END, CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END FROM duel_rooms WHERE id = ? AND status = 'finished' AND recorded = 0 ON CONFLICT(player_id) DO UPDATE SET played = played + 1, wins = wins + excluded.wins, draws = draws + excluded.draws").bind(id, id, room.id));
  statements.push(env.DB.prepare("UPDATE duel_rooms SET recorded = 1 WHERE id = ? AND status = 'finished' AND recorded = 0").bind(room.id));
  await env.DB.batch(statements);
}
async function duelEnd(env, room, winner, reason, cancelled = false) {
  await env.DB.batch([
    env.DB.prepare("UPDATE duel_rooms SET status = ?, winner_id = ?, finish_reason = ? WHERE id = ? AND status IN ('lobby', 'playing')").bind(cancelled ? 'cancelled' : 'finished', winner, reason, room.id),
    env.DB.prepare("DELETE FROM duel_seats WHERE room_id = ? AND EXISTS (SELECT 1 FROM duel_rooms WHERE id = ? AND status IN ('finished', 'cancelled'))").bind(room.id, room.id)
  ]);
  const latest = await duelRow(env, room.code); await duelRecord(env, latest); return latest;
}
async function duelAdvance(env, room) {
  const now = Date.now();
  if (['finished', 'cancelled'].includes(room.status)) { await duelRecord(env, room); return room; }
  if (room.expires_at <= now) return duelEnd(env, room, null, 'expired', true);
  if (room.status === 'lobby') return room;
  const hostAway = now - room.host_seen > DUEL_AWAY_MS, guestAway = now - room.guest_seen > DUEL_AWAY_MS;
  if (hostAway || guestAway) return duelEnd(env, room, hostAway ? room.guest_id : room.host_id, hostAway && guestAway ? 'both-away' : 'disconnected', hostAway && guestAway);
  if (room.phase === 'preparing' && now > room.load_deadline) {
    return duelEnd(env, room, room.ready_host ? room.host_id : room.guest_id, 'not-ready', !room.ready_host && !room.ready_guest);
  }
  if (room.phase === 'playing') {
    const answers = (await duelAnswers(env, room.id)).filter(a => a.round_index === room.round_index);
    if (answers.length === 2 || now >= room.ends_at) {
      const statements = [];
      if (now >= room.ends_at) for (const id of [room.host_id, room.guest_id]) statements.push(env.DB.prepare("INSERT OR IGNORE INTO duel_answers (room_id, round_index, player_id, answered_at, request_id) SELECT id, round_index, ?, ?, 'timeout' FROM duel_rooms WHERE id = ? AND status = 'playing' AND phase = 'playing' AND round_index = ?").bind(id, now, room.id, room.round_index));
      statements.push(env.DB.prepare("UPDATE duel_rooms SET phase = 'reveal', reveal_at = ? WHERE id = ? AND status = 'playing' AND phase = 'playing' AND round_index = ?").bind(now, room.id, room.round_index));
      await env.DB.batch(statements); room = await duelRow(env, room.code);
    }
  }
  if (room.phase === 'reveal' && now >= room.reveal_at + DUEL_REVEAL_MS) {
    if (room.round_index + 1 >= JSON.parse(room.snapshot).length) return duelEnd(env, room, duelCompare(room, await duelAnswers(env, room.id)), 'completed');
    await env.DB.prepare("UPDATE duel_rooms SET round_index = round_index + 1, phase = 'preparing', ready_host = 0, ready_guest = 0, starts_at = NULL, ends_at = NULL, reveal_at = NULL, load_deadline = ? WHERE id = ? AND status = 'playing' AND phase = 'reveal' AND round_index = ?").bind(now + 60000, room.id, room.round_index).run();
    room = await duelRow(env, room.code);
  }
  return room;
}
async function duelView(env, room, user) {
  const now = Date.now(), snapshot = JSON.parse(room.snapshot), level = snapshot[room.round_index];
  const answers = await duelAnswers(env, room.id);
  const rows = (await env.DB.prepare('SELECT id, nickname FROM players WHERE id = ? OR id = ?').bind(room.host_id, room.guest_id).all()).results;
  const revealed = room.phase === 'reveal' || room.status === 'finished';
  function player(id) {
    if (!id) return null;
    const completed = answers.filter(a => a.player_id === id && (a.round_index < room.round_index || revealed));
    return { nickname: rows.find(p => p.id === id)?.nickname || 'Игрок', score: completed.reduce((n, a) => n + a.score, 0),
      correct: completed.reduce((n, a) => n + a.correct, 0), answered: answers.some(a => a.player_id === id && a.round_index === room.round_index),
      ready: !!(id === room.host_id ? room.ready_host : room.ready_guest) };
  }
  const own = answers.find(a => a.player_id === user && a.round_index === room.round_index);
  const response = { code: room.code, status: room.status, phase: room.phase, isPublic: !!room.is_public, round: room.round_index + 1, total: snapshot.length, pack: room.pack,
    serverTime: now, startsAt: room.starts_at, endsAt: room.ends_at, nextAt: room.reveal_at ? room.reveal_at + DUEL_REVEAL_MS : null,
    loadDeadline: room.load_deadline, expiresAt: room.expires_at, you: player(user), opponent: player(user === room.host_id ? room.guest_id : room.host_id),
    isHost: user === room.host_id, outcome: room.status === 'finished' ? room.winner_id ? room.winner_id === user ? 'win' : 'loss' : 'draw' : null,
    reason: room.finish_reason, rematchCode: room.rematch_code,
    challenge: ['lobby', 'playing'].includes(room.status) && level ? { title: level.title, theme: level.theme, target: { id: level.target.id, audio: level.target.audio }, options: level.options } : null };
  if (revealed && level) response.result = { correct: !!own?.correct, selected: own ? level.options.findIndex(o => o.id === own.option_id) : -1,
    correctIndex: level.options.findIndex(o => o.id === level.target.id), meme: level.target, timedOut: own?.request_id === 'timeout' };
  return response;
}
async function duelCurrent(env, user) {
  const room = await env.DB.prepare('SELECT r.* FROM duel_rooms r JOIN duel_seats s ON s.room_id = r.id WHERE s.player_id = ?').bind(user).first();
  return room ? duelAdvance(env, room) : null;
}
async function duelSnapshot(services, pack) {
  const levels = await services.levels(); if (!levels.length) duelFail('Пока нет готовых уровней. Автор может добавить их в редакторе.');
  const count = Math.ceil(levels.length / 5), index = Math.max(0, Math.min(count - 1, Math.floor(Number(pack) || 0)));
  return { pack: index, snapshot: JSON.stringify(levels.slice(index * 5, index * 5 + 5).map(level => ({ title: level.title, theme: level.theme, target: level.target, options: services.shuffle(level.options) }))) };
}
async function duelCreate(env, services, user, body) {
  const current = await duelCurrent(env, user);
  if (current && ['lobby', 'playing'].includes(current.status)) return current;
  const data = await duelSnapshot(services, body.pack), now = Date.now();
  for (let i = 0; i < 4; i++) {
    const id = crypto.randomUUID(), code = duelCode();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO duel_rooms (id, code, host_id, pack, snapshot, host_seen, created_at, expires_at, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, code, user, data.pack, data.snapshot, now, now, now + 20 * 60000, Number(body.isPublic === true)),
        env.DB.prepare('INSERT INTO duel_seats (player_id, room_id) VALUES (?, ?)').bind(user, id)
      ]);
      return duelRow(env, code);
    } catch (error) {
      const existing = await duelCurrent(env, user); if (existing && ['lobby', 'playing'].includes(existing.status)) return existing;
      if (!/UNIQUE/i.test(error.message)) throw error;
    }
  }
  duelFail('Не удалось создать код комнаты. Попробуй ещё раз.', 503);
}
async function duelJoin(env, room, user) {
  room = await duelAdvance(env, room);
  if ([room.host_id, room.guest_id].includes(user)) return room;
  if (room.status !== 'lobby' || room.guest_id) duelFail('В этой дуэли уже два игрока или она закончилась.', 409);
  if (room.is_public && room.host_seen < Date.now() - 45000) duelFail('Автор комнаты уже не в сети. Выбери другую комнату.', 409);
  const current = await duelCurrent(env, user);
  if (current && ['lobby', 'playing'].includes(current.status)) duelFail('Сначала выйди из своей текущей дуэли.', 409);
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE duel_rooms SET guest_id = ?, guest_seen = ?, ready_host = 0, ready_guest = 0 WHERE id = ? AND status = 'lobby' AND guest_id IS NULL").bind(user, Date.now(), room.id),
      env.DB.prepare("INSERT INTO duel_seats (player_id, room_id) SELECT ?, id FROM duel_rooms WHERE id = ? AND guest_id = ? AND status = 'lobby'").bind(user, room.id, user)
    ]);
  } catch (error) { if (!/UNIQUE/i.test(error.message)) throw error; }
  const latest = await duelRow(env, room.code); if (latest.guest_id !== user) duelFail('В этой дуэли уже два игрока.', 409);
  const seat = await env.DB.prepare('SELECT room_id FROM duel_seats WHERE player_id = ?').bind(user).first();
  if (seat?.room_id !== room.id) duelFail('Сначала выйди из своей текущей дуэли.', 409);
  return latest;
}
async function duelReady(env, room, user, body) {
  if (!room.guest_id && room.status === 'lobby') duelFail('Сначала пригласи второго игрока.', 409);
  if (body.round !== room.round_index + 1) duelFail('Комната уже сменилась. Обновляем дуэль.', 409);
  if (!['lobby', 'playing'].includes(room.status) || room.phase !== 'preparing') return room;
  const field = room.host_id === user ? 'ready_host' : 'ready_guest';
  await env.DB.batch([
    env.DB.prepare(`UPDATE duel_rooms SET ${field} = 1 WHERE id = ? AND round_index = ? AND phase = 'preparing' AND status IN ('lobby', 'playing')`).bind(room.id, room.round_index),
    env.DB.prepare("UPDATE duel_rooms SET status = 'playing', phase = 'playing', starts_at = ?, ends_at = ?, expires_at = ? WHERE id = ? AND round_index = ? AND phase = 'preparing' AND status IN ('lobby', 'playing') AND ready_host = 1 AND ready_guest = 1 AND guest_id IS NOT NULL").bind(Date.now() + DUEL_COUNTDOWN_MS, Date.now() + DUEL_COUNTDOWN_MS + DUEL_ROUND_MS, Date.now() + 20 * 60000, room.id, room.round_index)
  ]);
  return duelRow(env, room.code);
}
async function duelAnswer(env, room, user, body) {
  const existing = await env.DB.prepare('SELECT request_id FROM duel_answers WHERE room_id = ? AND round_index = ? AND player_id = ?').bind(room.id, Number(body.round) - 1, user).first();
  if (existing && existing.request_id === body.requestId) return duelAdvance(env, room);
  if (typeof body.requestId !== 'string' || body.requestId.length < 10 || body.requestId.length > 80 || body.round !== room.round_index + 1) duelFail('Этот ответ уже не относится к текущей комнате.', 409);
  const now = Date.now();
  if (room.status !== 'playing' || room.phase !== 'playing' || now < room.starts_at || now >= room.ends_at) duelFail('Время ответа ещё не началось или уже закончилось.', 409);
  const level = JSON.parse(room.snapshot)[room.round_index];
  if (!level.options.some(o => o.id === body.optionId)) duelFail('Выбери одну из картинок в комнате.');
  const correct = body.optionId === level.target.id;
  await env.DB.prepare("INSERT OR IGNORE INTO duel_answers (room_id, round_index, player_id, option_id, correct, score, answered_at, request_id) SELECT id, round_index, ?, ?, ?, ?, ?, ? FROM duel_rooms WHERE id = ? AND round_index = ? AND phase = 'playing' AND status = 'playing' AND starts_at <= ? AND ends_at > ?")
    .bind(user, body.optionId, Number(correct), correct ? 100 : 0, now, body.requestId, room.id, room.round_index, now, now).run();
  return duelAdvance(env, await duelRow(env, room.code));
}
async function duelRematch(env, room, services, user) {
  if (room.status !== 'finished') duelFail('Сначала закончите текущую дуэль.', 409);
  if (room.rematch_code) return duelRow(env, room.rematch_code);
  for (const id of [room.host_id, room.guest_id]) {
    const current = await duelCurrent(env, id); if (current && ['lobby', 'playing'].includes(current.status)) duelFail('Один из игроков уже в другой дуэли. Можно создать новую комнату.', 409);
  }
  const all = await services.levels(), count = Math.ceil(all.length / 5), data = await duelSnapshot(services, (room.pack + 1) % Math.max(1, count));
  const id = crypto.randomUUID(), code = duelCode(), now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO duel_rooms (id, code, host_id, guest_id, pack, snapshot, host_seen, guest_seen, created_at, expires_at) SELECT ?, ?, host_id, guest_id, ?, ?, ?, ?, ?, ? FROM duel_rooms WHERE id = ? AND rematch_code IS NULL").bind(id, code, data.pack, data.snapshot, now, now, now, now + 20 * 60000, room.id),
      env.DB.prepare('INSERT INTO duel_seats (player_id, room_id) SELECT host_id, id FROM duel_rooms WHERE id = ?').bind(id),
      env.DB.prepare('INSERT INTO duel_seats (player_id, room_id) SELECT guest_id, id FROM duel_rooms WHERE id = ?').bind(id),
      env.DB.prepare('UPDATE duel_rooms SET rematch_code = ? WHERE id = ? AND rematch_code IS NULL AND EXISTS (SELECT 1 FROM duel_rooms WHERE id = ?)').bind(code, room.id, id)
    ]);
  } catch (error) { const latest = await duelRow(env, room.code); if (latest.rematch_code) return duelRow(env, latest.rematch_code); throw error; }
  return duelRow(env, (await duelRow(env, room.code)).rematch_code);
}
async function duelRanking(env, user) {
  const rows = (await env.DB.prepare('SELECT s.*, p.nickname FROM duel_stats s JOIN players p ON p.id = s.player_id ORDER BY s.wins DESC, s.draws DESC, s.played, p.nickname_key LIMIT 50').all()).results;
  const own = user ? await env.DB.prepare('SELECT * FROM duel_stats WHERE player_id = ?').bind(user).first() : null;
  return duelJSON({ rows: rows.map((r, i) => ({ rank: i + 1, nickname: r.nickname, wins: r.wins, played: r.played, draws: r.draws, isYou: r.player_id === user })),
    you: own ? { wins: own.wins, played: own.played, draws: own.draws } : null });
}

async function duelOpenRooms(env, user) {
  const rows = (await env.DB.prepare("SELECT r.code, r.pack, json_array_length(r.snapshot) AS total, p.nickname FROM duel_rooms r JOIN players p ON p.id = r.host_id WHERE r.is_public = 1 AND r.status = 'lobby' AND r.guest_id IS NULL AND r.expires_at > ? AND r.host_seen > ? AND r.host_id <> ? ORDER BY r.created_at DESC LIMIT 30")
    .bind(Date.now(), Date.now() - 45000, user || '').all()).results;
  return duelJSON({ rooms: rows.map(row => ({ code: row.code, host: row.nickname, pack: row.pack, total: row.total, players: 1, capacity: 2 })) });
}

export async function handleDuelApi(request, env, services) {
  const url = new URL(request.url), path = url.pathname, user = services.user;
  if (path === '/api/duels/rooms' && request.method === 'GET') return duelOpenRooms(env, user);
  if (path === '/api/duels/ranking' && request.method === 'GET') return duelRanking(env, user);
  if (path === '/api/duels/options' && request.method === 'GET') {
    const levels = await services.levels(); return duelJSON({ packs: Array.from({ length: Math.ceil(levels.length / 5) }, (_, index) => ({ index, title: `Комнаты ${index * 5 + 1}–${Math.min(levels.length, index * 5 + 5)}`, total: Math.min(5, levels.length - index * 5) })) });
  }
  if (!user) duelFail('Для живой дуэли войди через ChatGPT и выбери ник.', 401);
  if (!services.profile) duelFail('Сначала выбери ник в профиле.', 428);
  if (path === '/api/duels/current' && request.method === 'GET') {
    const room = await duelCurrent(env, user); return duelJSON({ room: room ? await duelView(env, room, user) : null });
  }
  if (path === '/api/duels' && request.method === 'POST') return duelJSON(await duelView(env, await duelCreate(env, services, user, await services.body(request)), user), 201);
  const match = path.match(/^\/api\/duels\/([A-Z2-9]{6})(?:\/(join|ready|answer|leave|rematch))?$/i);
  if (!match) return duelJSON({ error: 'Не найдено.' }, 404);
  let room = await duelRow(env, match[1].toUpperCase()); if (!room) duelFail('Комната не найдена. Проверь код.', 404);
  if (match[2] === 'join' && request.method === 'POST') return duelJSON(await duelView(env, await duelJoin(env, room, user), user));
  if (![room.host_id, room.guest_id].includes(user)) duelFail('Эта дуэль доступна только её участникам.', 403);
  room = await duelAdvance(env, room);
  if (['lobby', 'playing'].includes(room.status)) {
    const field = user === room.host_id ? 'host_seen' : 'guest_seen';
    if (Date.now() - room[field] > 10000) { await env.DB.prepare(`UPDATE duel_rooms SET ${field} = ? WHERE id = ?`).bind(Date.now(), room.id).run(); room[field] = Date.now(); }
  }
  if (!match[2] && request.method === 'GET') return duelJSON(await duelView(env, room, user));
  if (request.method !== 'POST') return duelJSON({ error: 'Не найдено.' }, 404);
  if (match[2] === 'ready') room = await duelReady(env, room, user, await services.body(request));
  else if (match[2] === 'answer') room = await duelAnswer(env, room, user, await services.body(request));
  else if (match[2] === 'leave') {
    if (room.status === 'lobby' && user === room.guest_id) {
      await env.DB.batch([env.DB.prepare("UPDATE duel_rooms SET guest_id = NULL, guest_seen = NULL, ready_host = 0, ready_guest = 0 WHERE id = ? AND status = 'lobby'").bind(room.id), env.DB.prepare('DELETE FROM duel_seats WHERE player_id = ? AND room_id = ?').bind(user, room.id)]);
      return duelJSON({ left: true });
    }
    room = await duelEnd(env, room, user === room.host_id ? room.guest_id : room.host_id, 'left', room.status === 'lobby');
  }
  else if (match[2] === 'rematch') room = await duelRematch(env, room, services, user);
  else return duelJSON({ error: 'Не найдено.' }, 404);
  return duelJSON(await duelView(env, room, user));
}
