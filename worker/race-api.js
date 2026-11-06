const RACE_ROOM_MS = 45000, RACE_BONUS_MS = 20000;
function raceProgress(answers, player, total) {
  const own = answers.filter(a => a.player_id === player).sort((a, b) => a.round_index - b.round_index);
  let completed = 0;
  while (completed < total && own[completed]?.round_index === completed) completed++;
  return { answers: own.slice(0, completed), completed, last: own[completed - 1], finished: completed === total };
}
export function raceFinishedMembers(room, members, answers) {
  const total = JSON.parse(room.snapshot).length;
  return new Set(members.filter(m => raceProgress(answers, m.player_id, total).finished).map(m => m.player_id));
}
export async function raceAdvance(env, room, services) {
  if (room.phase !== 'playing' || room.status !== 'playing') return room;
  const now = Date.now(), total = JSON.parse(room.snapshot).length;
  let answers = await services.answers(env, room.id);
  const members = (await services.members(env, room.id)).filter(m => m.state === 'joined');
  const statements = [];
  for (const member of members) {
    const progress = raceProgress(answers, member.player_id, total);
    let starts = progress.last?.answered_at ?? room.starts_at;
    for (let index = progress.completed; index < total && starts + RACE_ROOM_MS <= now; index++) {
      const ends = starts + RACE_ROOM_MS;
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO match_answers (room_id, round_index, player_id, answered_at, request_id, elapsed_ms) SELECT r.id, ?, m.player_id, ?, 'timeout', ? FROM match_rooms r JOIN match_members m ON m.room_id = r.id WHERE r.id = ? AND r.status = 'playing' AND r.phase = 'playing' AND m.player_id = ? AND m.state = 'joined' AND (SELECT COUNT(*) FROM match_answers WHERE room_id = r.id AND player_id = m.player_id) = ? AND COALESCE((SELECT answered_at FROM match_answers WHERE room_id = r.id AND player_id = m.player_id AND round_index = ?), r.starts_at) = ?").bind(index, ends, RACE_ROOM_MS, room.id, member.player_id, index, index - 1, starts));
      starts = ends;
    }
  }
  if (statements.length) { await env.DB.batch(statements); answers = await services.answers(env, room.id); }
  const results = members.map(m => {
    const p = raceProgress(answers, m.player_id, total);
    return { id: m.player_id, finished: p.finished, score: p.answers.reduce((n, a) => n + a.score, 0), time: (p.last?.answered_at ?? room.starts_at) - room.starts_at };
  });
  if (results.every(p => p.finished)) {
    const bestScore = Math.max(...results.map(p => p.score)), fastest = Math.min(...results.filter(p => p.score === bestScore).map(p => p.time));
    return services.end(env, room, 'completed', results.filter(p => p.score === bestScore && p.time === fastest).map(p => p.id));
  }
  return room;
}
export async function raceView(env, room, user, services) {
  const members = await services.members(env, room.id), own = members.find(m => m.player_id === user);
  if (!own) services.fail('Ты не участник этой комнаты.', 403);
  const snapshot = JSON.parse(room.snapshot), total = snapshot.length, answers = await services.answers(env, room.id), now = Date.now();
  const players = members.map(m => {
    const p = raceProgress(answers, m.player_id, total);
    return { slot: m.slot, nickname: m.nickname, isYou: m.player_id === user, isHost: m.player_id === room.host_id, active: m.state === 'joined', ready: !!m.ready,
      answered: p.finished, finished: p.finished, completed: p.completed, round: Math.min(p.completed + 1, total),
      score: p.answers.reduce((n, a) => n + a.score, 0), correct: p.answers.reduce((n, a) => n + a.correct, 0), speedBonus: p.answers.reduce((n, a) => n + a.speed_bonus, 0),
      elapsedMs: room.starts_at ? Math.max(0, (p.finished ? p.last.answered_at : now) - room.starts_at) : 0, outcome: m.outcome };
  });
  const mine = raceProgress(answers, user, total), level = snapshot[mine.completed], starts = mine.last?.answered_at ?? room.starts_at;
  const response = { id: room.id, title: room.title, locked: !!room.password_hash, capacity: 4, mode: 'race', isHost: room.host_id === user, status: room.status, phase: room.phase,
    round: Math.min(mine.completed + 1, total), total, pack: room.pack, players, you: players.find(p => p.isYou), count: members.filter(m => m.state === 'joined').length,
    canStart: room.status === 'lobby' && members.filter(m => m.state === 'joined').length >= 2 && members.filter(m => m.state === 'joined').every(m => m.ready),
    startsAt: starts, raceStartsAt: room.starts_at, endsAt: starts ? starts + RACE_ROOM_MS : null, nextAt: null, serverTime: now, reason: room.finish_reason, rematchId: room.rematch_id,
    track: own.state === 'joined' && ['lobby', 'playing'].includes(room.status) ? snapshot.map(l => ({ title: l.title, theme: l.theme, target: { id: l.target.id, audio: l.target.audio }, options: l.options })) : [],
    challenge: own.state === 'joined' && level && ['lobby', 'playing'].includes(room.status) ? { title: level.title, theme: level.theme, target: { id: level.target.id, audio: level.target.audio }, options: level.options } : null };
  if (mine.last) {
    const prior = snapshot[mine.last.round_index];
    response.result = { round: mine.last.round_index + 1, correct: !!mine.last.correct, timedOut: mine.last.request_id === 'timeout', gained: mine.last.score, speedBonus: mine.last.speed_bonus, elapsedMs: mine.last.elapsed_ms,
      selected: prior.options.findIndex(o => o.id === mine.last.option_id), correctIndex: prior.options.findIndex(o => o.id === prior.target.id), meme: prior.target };
  }
  return response;
}
export async function raceAnswer(env, room, user, body, services) {
  if (typeof body.requestId !== 'string' || body.requestId.length < 10 || body.requestId.length > 80 || !Number.isInteger(body.round)) services.fail('Неверный запрос ответа.');
  const answers = await services.answers(env, room.id), snapshot = JSON.parse(room.snapshot), mine = raceProgress(answers, user, snapshot.length), index = body.round - 1;
  const prior = mine.answers.find(a => a.round_index === index);
  if (prior?.request_id === body.requestId) return services.advance(env, room);
  const now = Date.now(), starts = mine.last?.answered_at ?? room.starts_at;
  if (room.status !== 'playing' || room.phase !== 'playing' || mine.finished || mine.completed !== index || now < starts || now >= starts + RACE_ROOM_MS) services.fail('Эта комната уже пройдена. Обновляем гонку.', 409);
  if (!(await services.members(env, room.id)).some(m => m.player_id === user && m.state === 'joined')) services.fail('Ты уже вышел из матча.', 403);
  const level = snapshot[index];
  if (!level.options.some(o => o.id === body.optionId)) services.fail('Выбери одну из трёх картинок.');
  const correct = body.optionId === level.target.id, elapsed = Math.max(0, now - starts), bonus = correct ? Math.max(0, Math.round(50 * (1 - elapsed / RACE_BONUS_MS))) : 0;
  const changed = await env.DB.prepare("INSERT OR IGNORE INTO match_answers (room_id, round_index, player_id, option_id, correct, score, answered_at, request_id, elapsed_ms, speed_bonus) SELECT r.id, ?, m.player_id, ?, ?, ?, ?, ?, ?, ? FROM match_rooms r JOIN match_members m ON m.room_id = r.id WHERE r.id = ? AND r.status = 'playing' AND r.phase = 'playing' AND m.player_id = ? AND m.state = 'joined' AND (SELECT COUNT(*) FROM match_answers WHERE room_id = r.id AND player_id = m.player_id) = ? AND COALESCE((SELECT answered_at FROM match_answers WHERE room_id = r.id AND player_id = m.player_id AND round_index = ?), r.starts_at) = ? AND ? >= ? AND ? < ?").bind(index, body.optionId, Number(correct), correct ? 100 + bonus : 0, now, body.requestId, elapsed, bonus, room.id, user, index, index - 1, starts, now, starts, now, starts + RACE_ROOM_MS).run();
  if (!changed.meta.changes) {
    const saved = await env.DB.prepare('SELECT request_id FROM match_answers WHERE room_id = ? AND round_index = ? AND player_id = ?').bind(room.id, index, user).first();
    if (saved?.request_id !== body.requestId) services.fail('Ответ уже принят. Обновляем гонку.', 409);
  }
  return services.advance(env, room);
}
