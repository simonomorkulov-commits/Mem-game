import { raceAdvance, raceView, raceAnswer, raceFinishedMembers } from './race-api.js';
const GROUP_COUNTDOWN_MS = 3500, GROUP_ROUND_MS = 45000, GROUP_REVEAL_MS = 4000;
const groupJSON = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function groupFail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const groupRow = (env, id) => env.DB.prepare('SELECT * FROM match_rooms WHERE id = ?').bind(id).first();
const groupMembers = (env, id) => env.DB.prepare('SELECT m.*, p.nickname FROM match_members m JOIN players p ON p.id = m.player_id WHERE m.room_id = ? ORDER BY m.slot').bind(id).all().then(r => r.results);
const groupAnswers = (env, id) => env.DB.prepare('SELECT * FROM match_answers WHERE room_id = ?').bind(id).all().then(r => r.results);
const groupActive = members => members.filter(m => m.state === 'joined');
async function groupPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function groupEqual(a, b) { if (a.length !== b.length) return false; let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0; }
async function groupCheckPassword(env, room, user, password) {
  if (!room.password_hash) return;
  const prior = await env.DB.prepare('SELECT * FROM match_password_attempts WHERE room_id = ? AND player_id = ?').bind(room.id, user).first();
  if (prior && prior.updated_at > Date.now() - 300000 && prior.failures >= 5) groupFail('Слишком много попыток. Попробуй через пять минут.', 429);
  if (typeof password !== 'string' || password.length > 64 || !groupEqual(await groupPassword(password, room.password_salt), room.password_hash)) {
    await env.DB.prepare('INSERT INTO match_password_attempts (room_id, player_id, failures, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(room_id, player_id) DO UPDATE SET failures = CASE WHEN updated_at > ? THEN failures + 1 ELSE 1 END, updated_at = excluded.updated_at').bind(room.id, user, Date.now(), Date.now() - 300000).run();
    groupFail('Неверный пароль комнаты.', 403);
  }
  await env.DB.prepare('DELETE FROM match_password_attempts WHERE room_id = ? AND player_id = ?').bind(room.id, user).run();
}
async function groupRecord(env, room) {
  if (!['finished', 'cancelled'].includes(room.status)) return;
  const statements = [];
  if (room.status === 'finished' && !room.recorded) {
    statements.push(env.DB.prepare("UPDATE match_members SET outcome = CASE WHEN state = 'left' THEN 'loss' WHEN EXISTS (SELECT 1 FROM json_each((SELECT winner_ids FROM match_rooms WHERE id = ?)) WHERE value = match_members.player_id) THEN CASE WHEN json_array_length((SELECT winner_ids FROM match_rooms WHERE id = ?)) = 1 THEN 'win' ELSE 'draw' END ELSE 'loss' END WHERE room_id = ? AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ? AND recorded = 0)").bind(room.id, room.id, room.id, room.id));
    statements.push(env.DB.prepare("INSERT INTO duel_stats (player_id, played, wins, draws) SELECT player_id, 1, CASE WHEN outcome = 'win' THEN 1 ELSE 0 END, CASE WHEN outcome = 'draw' THEN 1 ELSE 0 END FROM match_members WHERE room_id = ? AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ? AND status = 'finished' AND recorded = 0) ON CONFLICT(player_id) DO UPDATE SET played = played + 1, wins = wins + excluded.wins, draws = draws + excluded.draws").bind(room.id, room.id));
    statements.push(env.DB.prepare("UPDATE match_rooms SET recorded = 1 WHERE id = ? AND status = 'finished' AND recorded = 0").bind(room.id));
  }
  statements.push(env.DB.prepare('DELETE FROM match_seats WHERE room_id = ?').bind(room.id));
  await env.DB.batch(statements);
}
async function groupEnd(env, room, reason, winners = [], cancel = false) {
  await env.DB.prepare("UPDATE match_rooms SET status = ?, finish_reason = ?, winner_ids = ? WHERE id = ? AND status IN ('lobby', 'playing')").bind(cancel ? 'cancelled' : 'finished', reason, JSON.stringify(winners), room.id).run();
  const latest = await groupRow(env, room.id); await groupRecord(env, latest); return groupRow(env, room.id);
}
async function groupAdvance(env, room) {
  if (['finished', 'cancelled'].includes(room.status)) { await groupRecord(env, room); return groupRow(env, room.id); }
  const now = Date.now();
  if (room.expires_at <= now) return groupEnd(env, room, 'expired', [], true);
  let members = await groupMembers(env, room.id);
  const finished = room.mode === 'race' ? raceFinishedMembers(room, members, await groupAnswers(env, room.id)) : new Set();
  const absent = groupActive(members).filter(m => m.seen_at < now - 90000 && !finished.has(m.player_id));
  if (absent.length) {
    const statements = absent.flatMap(m => [
      room.status === 'lobby' ? env.DB.prepare('DELETE FROM match_members WHERE room_id = ? AND player_id = ?').bind(room.id, m.player_id)
        : env.DB.prepare("UPDATE match_members SET state = 'left', ready = 0 WHERE room_id = ? AND player_id = ?").bind(room.id, m.player_id),
      env.DB.prepare('DELETE FROM match_seats WHERE room_id = ? AND player_id = ?').bind(room.id, m.player_id)
    ]);
    await env.DB.batch(statements); members = await groupMembers(env, room.id);
  }
  let joined = groupActive(members);
  if (room.status === 'lobby') {
    if (!joined.length) return groupEnd(env, room, 'empty', [], true);
    if (!joined.some(m => m.player_id === room.host_id)) {
      await env.DB.prepare("UPDATE match_rooms SET host_id = ? WHERE id = ? AND status = 'lobby'").bind(joined[0].player_id, room.id).run(); room = await groupRow(env, room.id);
    }
    return room;
  }
  if (joined.length < 2) return groupEnd(env, room, 'players-left', joined.map(m => m.player_id), !joined.length);
  if (room.phase === 'preparing') {
    if (now > room.load_deadline) {
      const failed = joined.filter(m => !m.ready);
      if (failed.length) {
        await env.DB.batch(failed.flatMap(m => [env.DB.prepare("UPDATE match_members SET state = 'left' WHERE room_id = ? AND player_id = ?").bind(room.id, m.player_id), env.DB.prepare('DELETE FROM match_seats WHERE room_id = ? AND player_id = ?').bind(room.id, m.player_id)]));
        joined = groupActive(await groupMembers(env, room.id));
        if (joined.length < 2) return groupEnd(env, room, 'not-ready', joined.map(m => m.player_id), !joined.length);
      }
    }
    if (joined.every(m => m.ready)) {
      await env.DB.prepare("UPDATE match_rooms SET phase = 'playing', starts_at = ?, ends_at = ? WHERE id = ? AND status = 'playing' AND phase = 'preparing' AND round_index = ? AND NOT EXISTS (SELECT 1 FROM match_members WHERE room_id = ? AND state = 'joined' AND ready = 0)").bind(now + GROUP_COUNTDOWN_MS, now + GROUP_COUNTDOWN_MS + GROUP_ROUND_MS, room.id, room.round_index, room.id).run();
      room = await groupRow(env, room.id);
    }
  }
  if (room.mode === 'race') return raceAdvance(env, room, { members: groupMembers, answers: groupAnswers, end: groupEnd });
  if (room.phase === 'playing') {
    const answers = (await groupAnswers(env, room.id)).filter(a => a.round_index === room.round_index);
    if (joined.every(m => answers.some(a => a.player_id === m.player_id)) || now >= room.ends_at) {
      const statements = [];
      if (now >= room.ends_at) statements.push(env.DB.prepare("INSERT OR IGNORE INTO match_answers (room_id, round_index, player_id, answered_at, request_id) SELECT m.room_id, r.round_index, m.player_id, ?, 'timeout' FROM match_members m JOIN match_rooms r ON r.id = m.room_id WHERE r.id = ? AND r.status = 'playing' AND r.phase = 'playing' AND r.round_index = ? AND m.state = 'joined'").bind(now, room.id, room.round_index));
      statements.push(env.DB.prepare("UPDATE match_rooms SET phase = 'reveal', reveal_at = ? WHERE id = ? AND status = 'playing' AND phase = 'playing' AND round_index = ?").bind(now, room.id, room.round_index));
      await env.DB.batch(statements); room = await groupRow(env, room.id);
    }
  }
  if (room.phase === 'reveal' && now >= room.reveal_at + GROUP_REVEAL_MS) {
    if (room.round_index + 1 >= JSON.parse(room.snapshot).length) {
      const answers = await groupAnswers(env, room.id), scores = joined.map(m => ({ id: m.player_id, score: answers.filter(a => a.player_id === m.player_id).reduce((n, a) => n + a.score, 0) }));
      const highest = Math.max(...scores.map(s => s.score)); return groupEnd(env, room, 'completed', scores.filter(s => s.score === highest).map(s => s.id));
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE match_members SET ready = 0 WHERE room_id = ? AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ? AND status = 'playing' AND phase = 'reveal' AND round_index = ?)").bind(room.id, room.id, room.round_index),
      env.DB.prepare("UPDATE match_rooms SET round_index = round_index + 1, phase = 'preparing', starts_at = NULL, ends_at = NULL, reveal_at = NULL, load_deadline = ? WHERE id = ? AND status = 'playing' AND phase = 'reveal' AND round_index = ?").bind(now + 60000, room.id, room.round_index)
    ]); room = await groupRow(env, room.id);
  }
  return room;
}
async function groupView(env, room, user) {
  if (room.mode === 'race') return raceView(env, room, user, { members: groupMembers, answers: groupAnswers, fail: groupFail });
  const members = await groupMembers(env, room.id), own = members.find(m => m.player_id === user);
  if (!own) groupFail('Ты не участник этой комнаты.', 403);
  const snapshot = JSON.parse(room.snapshot), level = snapshot[room.round_index], answers = await groupAnswers(env, room.id);
  const shown = room.phase === 'reveal' || room.status === 'finished';
  const players = members.map(m => {
    const completed = answers.filter(a => a.player_id === m.player_id && (a.round_index < room.round_index || shown));
    return { slot: m.slot, nickname: m.nickname, isYou: m.player_id === user, isHost: m.player_id === room.host_id, active: m.state === 'joined', ready: !!m.ready,
      answered: answers.some(a => a.player_id === m.player_id && a.round_index === room.round_index), score: completed.reduce((n, a) => n + a.score, 0), correct: completed.reduce((n, a) => n + a.correct, 0), outcome: m.outcome };
  });
  const ownAnswer = answers.find(a => a.player_id === user && a.round_index === room.round_index);
  const response = { id: room.id, title: room.title, locked: !!room.password_hash, capacity: 4, isHost: room.host_id === user, status: room.status, phase: room.phase,
    round: room.round_index + 1, total: snapshot.length, pack: room.pack, players, you: players.find(p => p.isYou), count: groupActive(members).length,
    canStart: room.status === 'lobby' && groupActive(members).length >= 2 && groupActive(members).every(m => m.ready),
    startsAt: room.starts_at, endsAt: room.ends_at, nextAt: room.reveal_at ? room.reveal_at + GROUP_REVEAL_MS : null, serverTime: Date.now(), reason: room.finish_reason, rematchId: room.rematch_id,
    challenge: own.state === 'joined' && ['lobby', 'playing'].includes(room.status) ? { title: level.title, theme: level.theme, target: { id: level.target.id, audio: level.target.audio }, options: level.options } : null };
  if (shown) response.result = { correct: !!ownAnswer?.correct, timedOut: ownAnswer?.request_id === 'timeout', selected: level.options.findIndex(o => o.id === ownAnswer?.option_id), correctIndex: level.options.findIndex(o => o.id === level.target.id), meme: level.target };
  return response;
}
async function groupCurrent(env, user) {
  const room = await env.DB.prepare('SELECT r.* FROM match_rooms r JOIN match_seats s ON s.room_id = r.id WHERE s.player_id = ?').bind(user).first();
  if (!room) return null;
  const current = await groupAdvance(env, room);
  return await env.DB.prepare("SELECT player_id FROM match_members WHERE room_id = ? AND player_id = ? AND state = 'joined'").bind(room.id, user).first() ? current : null;
}
async function groupSnapshot(services, value) {
  const levels = await services.levels(); if (!levels.length) groupFail('Автор ещё не добавил уровни для игры.');
  const count = Math.ceil(levels.length / 5), pack = Math.max(0, Math.min(count - 1, Math.floor(Number(value) || 0)));
  return { pack, snapshot: JSON.stringify(levels.slice(pack * 5, pack * 5 + 5).map(l => ({ title: l.title, theme: l.theme, target: l.target, options: services.shuffle(l.options) }))) };
}
async function groupCreate(env, services, user, body) {
  const current = await groupCurrent(env, user); if (current && ['lobby', 'playing'].includes(current.status)) return current;
  const title = String(body.title || `Комната ${services.profile.nickname}`).trim(); if (!title || title.length > 45) groupFail('Название комнаты — от 1 до 45 символов.');
  const password = body.password || ''; if (typeof password !== 'string' || (password && (password.length < 4 || password.length > 64))) groupFail('Пароль — от 4 до 64 символов.');
  const salt = password ? crypto.randomUUID() : null, hash = password ? await groupPassword(password, salt) : null;
  const data = await groupSnapshot(services, body.pack), id = crypto.randomUUID(), now = Date.now();
  try { await env.DB.batch([
    env.DB.prepare("INSERT INTO match_rooms (id, host_id, title, pack, snapshot, password_hash, password_salt, created_at, expires_at, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'race')").bind(id, user, title, data.pack, data.snapshot, hash, salt, now, now + 1200000),
    env.DB.prepare('INSERT INTO match_members (room_id, player_id, slot, joined_at, seen_at) VALUES (?, ?, 0, ?, ?)').bind(id, user, now, now),
    env.DB.prepare('INSERT INTO match_seats (player_id, room_id) VALUES (?, ?)').bind(user, id)
  ]); }
  catch (error) { const existing = await groupCurrent(env, user); if (existing && ['lobby', 'playing'].includes(existing.status)) return existing; throw error; }
  return groupRow(env, id);
}
async function groupJoin(env, room, user, body) {
  room = await groupAdvance(env, room);
  if ((await groupMembers(env, room.id)).some(m => m.player_id === user && m.state === 'joined')) return room;
  if (room.status !== 'lobby') groupFail('Матч уже начался или закончился. Выбери другую комнату.', 409);
  if (room.parent_id) groupFail('Это реванш для участников предыдущей игры.', 403);
  const current = await groupCurrent(env, user); if (current && ['lobby', 'playing'].includes(current.status)) groupFail('Сначала выйди из своей текущей комнаты.', 409);
  await groupCheckPassword(env, room, user, body.password);
  for (let attempt = 0; attempt < 4; attempt++) {
    const members = await groupMembers(env, room.id), slot = [0, 1, 2, 3].find(s => !members.some(m => m.slot === s));
    if (slot === undefined) groupFail('В комнате уже четыре игрока.', 409);
    try { await env.DB.batch([
      env.DB.prepare("INSERT INTO match_members (room_id, player_id, slot, joined_at, seen_at) SELECT id, ?, ?, ?, ? FROM match_rooms WHERE id = ? AND status = 'lobby' AND expires_at > ? AND (SELECT COUNT(*) FROM match_members WHERE room_id = ?) < 4").bind(user, slot, Date.now(), Date.now(), room.id, Date.now(), room.id),
      env.DB.prepare('INSERT INTO match_seats (player_id, room_id) SELECT player_id, room_id FROM match_members WHERE room_id = ? AND player_id = ?').bind(room.id, user)
    ]); }
    catch (error) {
      const active = await groupCurrent(env, user); if (active && active.id !== room.id && ['lobby', 'playing'].includes(active.status)) groupFail('Ты уже в другой комнате.', 409);
      if (!/UNIQUE/i.test(error.message)) throw error;
    }
    if (await env.DB.prepare('SELECT player_id FROM match_members WHERE room_id = ? AND player_id = ?').bind(room.id, user).first()) return groupRow(env, room.id);
    if ((await groupRow(env, room.id)).status !== 'lobby') groupFail('Матч уже начался. Выбери другую комнату.', 409);
  }
  groupFail('Свободное место уже заняли. Обнови список комнат.', 409);
}
async function groupReady(env, room, user, body) {
  if (body.round !== room.round_index + 1) groupFail('Уже открылась следующая комната.', 409);
  if (room.phase !== 'preparing' || !['lobby', 'playing'].includes(room.status)) return room;
  await env.DB.prepare("UPDATE match_members SET ready = ? WHERE room_id = ? AND player_id = ? AND state = 'joined' AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ? AND phase = 'preparing' AND round_index = ? AND status IN ('lobby', 'playing'))").bind(Number(body.ready !== false), room.id, user, room.id, room.round_index).run();
  return groupAdvance(env, await groupRow(env, room.id));
}
async function groupStart(env, room, user) {
  if (room.host_id !== user) groupFail('Начать матч может создатель комнаты.', 403);
  if (room.status !== 'lobby') return room;
  const changed = await env.DB.prepare("UPDATE match_rooms SET status = 'playing', load_deadline = ?, expires_at = ? WHERE id = ? AND status = 'lobby' AND (SELECT COUNT(*) FROM match_members WHERE room_id = ? AND state = 'joined') >= 2 AND NOT EXISTS (SELECT 1 FROM match_members WHERE room_id = ? AND state = 'joined' AND ready = 0)").bind(Date.now() + 60000, Date.now() + 1200000, room.id, room.id, room.id).run();
  if (!changed.meta.changes) groupFail('Нужно хотя бы два игрока, и все должны нажать «Готов».', 409);
  return groupAdvance(env, await groupRow(env, room.id));
}
async function groupAnswer(env, room, user, body) {
  if (room.mode === 'race') return raceAnswer(env, room, user, body, { members: groupMembers, answers: groupAnswers, advance: groupAdvance, fail: groupFail });
  if (typeof body.requestId !== 'string' || body.requestId.length < 10 || body.requestId.length > 80) groupFail('Неверный запрос ответа.');
  const prior = await env.DB.prepare('SELECT request_id FROM match_answers WHERE room_id = ? AND round_index = ? AND player_id = ?').bind(room.id, Number(body.round) - 1, user).first();
  if (prior?.request_id === body.requestId) return groupAdvance(env, room);
  if (body.round !== room.round_index + 1 || room.status !== 'playing' || room.phase !== 'playing' || Date.now() < room.starts_at || Date.now() >= room.ends_at) groupFail('В этой комнате уже нельзя ответить. Обновляем матч.', 409);
  const member = (await groupMembers(env, room.id)).find(m => m.player_id === user); if (member?.state !== 'joined') groupFail('Ты уже вышел из матча.', 403);
  const level = JSON.parse(room.snapshot)[room.round_index]; if (!level.options.some(o => o.id === body.optionId)) groupFail('Выбери одну из трёх картинок.');
  const correct = body.optionId === level.target.id, now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO match_answers (room_id, round_index, player_id, option_id, correct, score, answered_at, request_id) SELECT r.id, r.round_index, ?, ?, ?, ?, ?, ? FROM match_rooms r JOIN match_members m ON m.room_id = r.id AND m.player_id = ? WHERE r.id = ? AND r.status = 'playing' AND r.phase = 'playing' AND r.round_index = ? AND r.starts_at <= ? AND r.ends_at > ? AND m.state = 'joined'").bind(user, body.optionId, Number(correct), correct ? 100 : 0, now, body.requestId, user, room.id, room.round_index, now, now).run();
  return groupAdvance(env, await groupRow(env, room.id));
}
async function groupLeave(env, room, user) {
  await env.DB.batch([
    env.DB.prepare("UPDATE match_members SET state = 'left', ready = 0 WHERE room_id = ? AND player_id = ? AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ? AND status = 'playing')").bind(room.id, user, room.id),
    env.DB.prepare("DELETE FROM match_members WHERE room_id = ? AND player_id = ? AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ? AND status = 'lobby')").bind(room.id, user, room.id),
    env.DB.prepare("DELETE FROM match_seats WHERE room_id = ? AND player_id = ? AND NOT EXISTS (SELECT 1 FROM match_members WHERE room_id = ? AND player_id = ? AND state = 'joined')").bind(room.id, user, room.id, user)
  ]);
  await groupAdvance(env, await groupRow(env, room.id)); return groupJSON({ left: true });
}
async function groupRematch(env, room, services, user) {
  if (room.status !== 'finished') groupFail('Сначала закончите матч.', 409);
  if (room.rematch_id) return groupRow(env, room.rematch_id);
  const members = await groupMembers(env, room.id);
  for (const m of members) { const current = await groupCurrent(env, m.player_id); if (current && ['lobby', 'playing'].includes(current.status)) groupFail('Один из участников уже играет в другой комнате.', 409); }
  const levels = await services.levels(), count = Math.ceil(levels.length / 5), data = await groupSnapshot(services, (room.pack + 1) % Math.max(1, count));
  const id = crypto.randomUUID(), now = Date.now();
  try { await env.DB.batch([
    env.DB.prepare("INSERT INTO match_rooms (id, host_id, title, pack, snapshot, password_hash, password_salt, parent_id, created_at, expires_at, mode) SELECT ?, ?, title, ?, ?, password_hash, password_salt, id, ?, ?, 'race' FROM match_rooms WHERE id = ? AND rematch_id IS NULL").bind(id, user, data.pack, data.snapshot, now, now + 1200000, room.id),
    env.DB.prepare('INSERT INTO match_members (room_id, player_id, slot, joined_at, seen_at) SELECT ?, player_id, slot, ?, ? FROM match_members WHERE room_id = ? AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ?)').bind(id, now, now, room.id, id),
    env.DB.prepare('INSERT INTO match_seats (player_id, room_id) SELECT player_id, room_id FROM match_members WHERE room_id = ?').bind(id),
    env.DB.prepare('UPDATE match_rooms SET rematch_id = ? WHERE id = ? AND rematch_id IS NULL AND EXISTS (SELECT 1 FROM match_rooms WHERE id = ?)').bind(id, room.id, id)
  ]); }
  catch (error) { const latest = await groupRow(env, room.id); if (latest.rematch_id) return groupRow(env, latest.rematch_id); throw error; }
  return groupRow(env, (await groupRow(env, room.id)).rematch_id);
}
async function groupRoomList(env) {
  const rows = (await env.DB.prepare("SELECT r.id, r.title, r.pack, r.password_hash IS NOT NULL AS locked, json_array_length(r.snapshot) AS total, p.nickname AS host, (SELECT COUNT(*) FROM match_members m WHERE m.room_id = r.id AND m.state = 'joined') AS count FROM match_rooms r JOIN players p ON p.id = r.host_id JOIN match_members h ON h.room_id = r.id AND h.player_id = r.host_id WHERE r.status = 'lobby' AND r.parent_id IS NULL AND r.expires_at > ? AND h.seen_at > ? AND (SELECT COUNT(*) FROM match_members m WHERE m.room_id = r.id AND m.state = 'joined') < 4 ORDER BY r.created_at DESC LIMIT 30").bind(Date.now(), Date.now() - 45000).all()).results;
  return groupJSON({ rooms: rows.map(r => ({ ...r, locked: !!r.locked, capacity: 4 })) });
}
export async function handleMatchApi(request, env, services) {
  const path = new URL(request.url).pathname, user = services.user;
  if (path === '/api/matches/rooms' && request.method === 'GET') return groupRoomList(env);
  const preview = path.match(/^\/api\/matches\/([a-f0-9-]{36})\/preview$/);
  if (preview && request.method === 'GET') {
    const room = await groupRow(env, preview[1]); if (!room || room.expires_at < Date.now()) groupFail('Комната не найдена.', 404);
    const members = await groupMembers(env, room.id);
    return groupJSON({ id: room.id, title: room.title, locked: !!room.password_hash, status: room.status, count: groupActive(members).length, capacity: 4, host: members.find(m => m.player_id === room.host_id)?.nickname || 'Игрок' });
  }
  if (!user) groupFail('Выбери и сохрани ник, чтобы играть онлайн.', 401);
  if (!services.profile) groupFail('Сначала выбери ник в профиле.', 428);
  if (path === '/api/matches/current' && request.method === 'GET') { const room = await groupCurrent(env, user); return groupJSON({ room: room && ['lobby', 'playing'].includes(room.status) ? await groupView(env, room, user) : null }); }
  if (path === '/api/matches' && request.method === 'POST') return groupJSON(await groupView(env, await groupCreate(env, services, user, await services.body(request)), user), 201);
  const match = path.match(/^\/api\/matches\/([a-f0-9-]{36})(?:\/(join|ready|start|answer|leave|rematch))?$/);
  if (!match) return groupJSON({ error: 'Не найдено.' }, 404);
  let room = await groupRow(env, match[1]); if (!room) groupFail('Комната не найдена.', 404);
  if (match[2] === 'join' && request.method === 'POST') return groupJSON(await groupView(env, await groupJoin(env, room, user, await services.body(request)), user));
  const member = (await groupMembers(env, room.id)).find(m => m.player_id === user); if (!member) groupFail('Ты не участник этой комнаты.', 403);
  room = await groupAdvance(env, room);
  if (member.state === 'joined' && Date.now() - member.seen_at > 10000) await env.DB.prepare("UPDATE match_members SET seen_at = ? WHERE room_id = ? AND player_id = ? AND state = 'joined'").bind(Date.now(), room.id, user).run();
  if (!match[2] && request.method === 'GET') return groupJSON(await groupView(env, room, user));
  if (request.method !== 'POST') return groupJSON({ error: 'Не найдено.' }, 404);
  if (match[2] === 'ready') room = await groupReady(env, room, user, await services.body(request));
  else if (match[2] === 'start') room = await groupStart(env, room, user);
  else if (match[2] === 'answer') room = await groupAnswer(env, room, user, await services.body(request));
  else if (match[2] === 'leave') return groupLeave(env, room, user);
  else if (match[2] === 'rematch') room = await groupRematch(env, room, services, user);
  else return groupJSON({ error: 'Не найдено.' }, 404);
  return groupJSON(await groupView(env, room, user));
}
