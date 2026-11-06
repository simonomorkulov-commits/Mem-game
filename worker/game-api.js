import { scoreAnswer, INITIAL_LIVES, DEFAULT_LEVEL_COUNT, ROOM_THEMES } from '../client/scoring.js';
import { handleDuelApi } from './duel-api.js';
import { handleMatchApi } from './match-api.js';
import { handlePresenceApi } from './presence-api.js';
import { resolvePlayerIdentity, handleAccountApi } from './account-api.js';
import { planRooms, ROOM_PLANNER_VERSION } from './room-planner.js';

const gameJSON = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function gameFail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function gameHash(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function gameUser(request, env) { return (env.PLAYER_AUTH || await resolvePlayerIdentity(request, env)).id; }
async function gameBody(request) {
  const reader = request.body?.getReader(); if (!reader) return {};
  let text = '', length = 0; const decoder = new TextDecoder();
  for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length;
    if (length > 4096) { await reader.cancel(); gameFail('Слишком большой запрос.', 413); } text += decoder.decode(value, { stream: true }); }
  try { return JSON.parse(text + decoder.decode()); } catch { gameFail('Не удалось прочитать запрос.'); }
}
function gameShuffle(items) { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }

function gameStarterPool(memes) { return [...memes.filter(m => m.id.startsWith('part2-')), ...memes.filter(m => !m.id.startsWith('part2-'))]; }
function gameStarterContent(index, memes) {
  const target = memes[index % memes.length], others = memes.filter(m => m.id !== target.id), pairs = [];
  for (let a = 0; a < others.length - 1; a++) for (let b = a + 1; b < others.length; b++) pairs.push([others[a], others[b]]);
  const [a, b] = pairs[Math.floor(index / memes.length) % pairs.length];
  return { target: target.id, options: [target.id, a.id, b.id] };
}
async function gameUpgradeSecondPack(db, memes) {
  if (await db.prepare("SELECT value FROM game_config WHERE key = 'video-pack-v2'").first()) return;
  const pool = gameStarterPool(memes.filter(m => m.id.startsWith('jai-') || m.id.startsWith('part2-')));
  if (pool.filter(m => m.id.startsWith('part2-')).length !== 5) return;
  const previous = pool.filter(m => m.id.startsWith('jai-')), oldIds = new Set(previous.map(m => m.id));
  if (previous.length < 3) return;
  const rows = (await db.prepare("SELECT * FROM game_levels WHERE id LIKE 'starter-%'").all()).results, changes = [];
  for (const row of rows) {
    const index = Number(row.id.slice(8)) - 1;
    if (!Number.isInteger(index) || index < 0 || row.title !== `Комната ${index + 1}` || ![row.target_id, row.option_a, row.option_b, row.option_c].every(id => oldIds.has(id))) continue;
    const prior = gameStarterContent(index, previous), target = previous[index % previous.length], others = previous.filter(m => m.id !== target.id), pair = Math.floor(index / previous.length) % others.length;
    const oldOptions = [row.option_a, row.option_b, row.option_c].join(':');
    if (row.target_id !== target.id || ![prior.options.join(':'), [target.id, others[pair].id, others[(pair + 1) % others.length].id].join(':')].includes(oldOptions)) continue;
    const next = gameStarterContent(index, pool);
    changes.push(db.prepare("UPDATE game_levels SET target_id = ?, option_a = ?, option_b = ?, option_c = ? WHERE id = ? AND title = ? AND target_id = ? AND option_a = ? AND option_b = ? AND option_c = ? AND NOT EXISTS (SELECT 1 FROM game_config WHERE key = 'video-pack-v2')").bind(next.target, ...next.options, row.id, row.title, row.target_id, row.option_a, row.option_b, row.option_c));
  }
  changes.push(db.prepare("INSERT OR IGNORE INTO game_config (key, value) VALUES ('video-pack-v2', '1')"));
  await db.batch(changes);
}
async function gameSeed(db, memes) {
  if (await db.prepare("SELECT value FROM game_config WHERE key = 'seeded'").first()) {
    // Upgrade existing starter rooms once; deleted rooms and author-created rooms stay intact.
    if (!await db.prepare("SELECT value FROM game_config WHERE key = 'jai-pack-v1'").first()) {
      const oldIds = new Set(['bruh', 'vine-boom', 'among-us', 'metal-pipe', 'anime-wow', 'spongebob']);
      const available = memes.filter(m => m.id.startsWith('jai-'));
      if (available.length < 3) return;
      const rows = (await db.prepare("SELECT * FROM game_levels WHERE id LIKE 'starter-%'").all()).results, changes = [];
      for (const row of rows) {
        if (![row.target_id, row.option_a, row.option_b, row.option_c].every(id => oldIds.has(id))) continue;
        const index = Number(row.id.slice(8)) - 1; if (!Number.isInteger(index) || index < 0) continue;
        const target = available[index % available.length], others = available.filter(m => m.id !== target.id);
        const a = others[Math.floor(index / available.length) % others.length], b = others[(Math.floor(index / available.length) + 1) % others.length];
        changes.push(db.prepare("UPDATE game_levels SET target_id = ?, option_a = ?, option_b = ?, option_c = ? WHERE id = ? AND target_id = ? AND option_a = ? AND option_b = ? AND option_c = ? AND NOT EXISTS (SELECT 1 FROM game_config WHERE key = 'jai-pack-v1')").bind(target.id, target.id, a.id, b.id, row.id, row.target_id, row.option_a, row.option_b, row.option_c));
      }
      changes.push(db.prepare("INSERT OR IGNORE INTO game_config (key, value) VALUES ('jai-pack-v1', '1')"));
      await db.batch(changes);
    }
    await gameUpgradeSecondPack(db, memes);
    return;
  }
  if (memes.length < 3) gameFail('Для игры нужны хотя бы три мема.');
  const themes = Object.keys(ROOM_THEMES), statements = [], pool = gameStarterPool(memes);
  for (let i = 0; i < DEFAULT_LEVEL_COUNT; i++) {
    const content = gameStarterContent(i, pool);
    statements.push(db.prepare('INSERT OR IGNORE INTO game_levels (id, position, title, target_id, option_a, option_b, option_c, theme, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(`starter-${String(i + 1).padStart(3, '0')}`, i + 1, `Комната ${i + 1}`, content.target, ...content.options, themes[Math.floor(i / 5) % themes.length], new Date().toISOString()));
  }
  statements.push(db.prepare("INSERT OR IGNORE INTO game_config (key, value) VALUES ('seeded', '1')"));
  statements.push(db.prepare("INSERT OR IGNORE INTO game_config (key, value) VALUES ('jai-pack-v1', '1')"));
  if (pool.some(m => m.id.startsWith('part2-'))) statements.push(db.prepare("INSERT OR IGNORE INTO game_config (key, value) VALUES ('video-pack-v2', '1')"));
  await db.batch(statements);
}
async function gameLevels(env, services, manage = false) {
  const catalog = await services.catalog(); await gameSeed(env.DB, catalog.memes);
  const rows = (await env.DB.prepare('SELECT * FROM game_levels WHERE active = 1 ORDER BY position, id').all()).results;
  const all = new Map(catalog.all.map(m => [m.id, m])), active = new Set(catalog.memes.map(m => m.id));
  const builtins = catalog.all.filter(m => !m.custom), packs = [...new Set(builtins.map(m => m.id.split('-')[0]))];
  const pools = [...packs.slice(1).map((_, index) => gameStarterPool(builtins.filter(m => packs.indexOf(m.id.split('-')[0]) <= index + 1))), gameStarterPool(catalog.memes)].filter(pool => pool.length >= 3);
  const automaticPool = row => {
    const index = Number(row.id.slice(8)) - 1;
    if (!row.id.startsWith('starter-') || !Number.isInteger(index) || index < 0 || row.title !== `Комната ${index + 1}`) return undefined;
    return pools.some(pool => { const expected = gameStarterContent(index, pool); return expected.target === row.target_id && expected.options.join(':') === [row.option_a, row.option_b, row.option_c].join(':'); }) ? catalog.memes : undefined;
  };
  const playable = row => !row.id.startsWith('starter-') || [row.option_a, row.option_b, row.option_c].every(id => active.has(id));
  return rows.filter(row => [row.option_a, row.option_b, row.option_c].every(id => all.has(id)) && (manage || playable(row)))
    .map((row, index) => ({ ...row, number: manage ? row.position : index + 1, playable: playable(row), target: all.get(row.target_id), options: [row.option_a, row.option_b, row.option_c].map(id => all.get(id)), automaticPool: automaticPool(row) }));
}
async function gameProfile(db, user) { return user ? db.prepare('SELECT * FROM players WHERE id = ?').bind(user).first() : null; }
function gamePublicProfile(profile) {
  return profile ? { nickname: profile.nickname, bestScore: profile.best_score, furthestRoom: profile.furthest_room, gamesPlayed: profile.games_played, wins: profile.wins } : null;
}
async function gameSaveProfile(request, env, user) {
  if (!user) gameFail('Войди, чтобы выбрать ник.', 401);
  const body = await gameBody(request), nickname = String(body.nickname || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!/^[\p{L}\p{N}_ -]{3,20}$/u.test(nickname)) gameFail('Ник: от 3 до 20 букв, цифр, пробелов, дефисов или подчёркиваний.');
  const key = nickname.toLowerCase();
  if (await env.DB.prepare('SELECT id FROM players WHERE nickname_key = ? AND id <> ?').bind(key, user).first()) gameFail('Этот ник уже занят. Выбери другой.', 409);
  const now = new Date().toISOString();
  try { await env.DB.prepare('INSERT INTO players (id, nickname, nickname_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, updated_at = excluded.updated_at')
    .bind(user, nickname, key, now, now).run(); }
  catch (error) { if (/UNIQUE/i.test(error.message)) gameFail('Этот ник уже занят. Выбери другой.', 409); throw error; }
  return gameJSON({ profile: gamePublicProfile(await gameProfile(env.DB, user)) });
}
async function gameRanking(env, user) {
  const rows = (await env.DB.prepare('SELECT * FROM players WHERE games_played > 0 ORDER BY best_score DESC, furthest_room DESC, nickname_key LIMIT 50').all()).results;
  const mine = await gameProfile(env.DB, user);
  let place = null;
  if (mine?.games_played > 0) {
    const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM players WHERE games_played > 0 AND (best_score > ? OR (best_score = ? AND furthest_room > ?) OR (best_score = ? AND furthest_room = ? AND nickname_key < ?))')
      .bind(mine.best_score, mine.best_score, mine.furthest_room, mine.best_score, mine.furthest_room, mine.nickname_key).first(); place = Number(ahead.n) + 1;
  }
  return gameJSON({ rows: rows.map((p, i) => ({ rank: i + 1, nickname: p.nickname, score: p.best_score, rooms: p.furthest_room, isYou: p.id === user })),
    you: mine ? { ...gamePublicProfile(mine), rank: place } : null });
}

function gameCurrent(run) {
  const snapshot = JSON.parse(run.snapshot), level = snapshot[run.round_index];
  const stats = { runId: run.id, revision: run.revision, round: Math.min(run.round_index + 1, snapshot.length), total: snapshot.length,
    score: run.score, lives: run.lives, streak: run.streak, correct: run.correct, ranked: !!run.player_id, finished: run.status === 'finished' };
  return { ...stats, status: stats.finished ? 'finished' : 'playing', challenge: level ? { title: level.title, theme: level.theme,
    target: { id: level.target.id, audio: level.target.audio }, options: level.options } : null };
}
async function gameAuthorizeRun(request, env, id, user) {
  const run = await env.DB.prepare('SELECT * FROM game_runs WHERE id = ?').bind(id).first();
  if (!run || run.expires_at < Date.now()) gameFail('Партия закончилась или устарела. Начни новую.', 404);
  if (run.player_id) { if (run.player_id !== user) gameFail('Эта партия принадлежит другому игроку.', 403); }
  else { const token = request.headers.get('x-game-token'); if (!token || await gameHash(token) !== run.token_hash) gameFail('Нет доступа к этой партии.', 403); }
  return run;
}
function gameRecordStatements(env, id, playerId) {
  if (!playerId) return [];
  return [
    env.DB.prepare("UPDATE players SET best_score = MAX(best_score, (SELECT score FROM game_runs WHERE id = ?)), furthest_room = MAX(furthest_room, (SELECT round_index FROM game_runs WHERE id = ?)), games_played = games_played + 1, wins = wins + (SELECT CASE WHEN lives > 0 AND round_index >= json_array_length(snapshot) THEN 1 ELSE 0 END FROM game_runs WHERE id = ?), updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM game_runs WHERE id = ? AND status = 'finished' AND recorded = 0)")
      .bind(id, id, id, new Date().toISOString(), playerId, id),
    env.DB.prepare("UPDATE game_runs SET recorded = 1 WHERE id = ? AND status = 'finished' AND recorded = 0").bind(id)
  ];
}
async function gameStart(request, env, services, user) {
  const profile = await gameProfile(env.DB, user);
  if (user && !profile) gameFail('Сначала выбери ник в профиле.', 428);
  const levels = await gameLevels(env, services); if (!levels.length) gameFail('Пока нет готовых уровней. Автор может создать их в редакторе.');
  if (profile) {
    const active = await env.DB.prepare("SELECT * FROM game_runs WHERE player_id = ? AND status = 'active' AND expires_at > ? ORDER BY started_at DESC LIMIT 1").bind(user, Date.now()).first();
    if (active) {
      const legacy = new Set(['bruh', 'vine-boom', 'among-us', 'metal-pipe', 'anime-wow', 'spongebob']);
      const snapshot = JSON.parse(active.snapshot);
      const outdatedStarterPack = snapshot.some(level => level.id?.startsWith('starter-')) && !snapshot.some(level => level.target.id.startsWith('part2-')) && levels.some(level => level.target.id.startsWith('part2-'));
      const outdatedPlanner = snapshot.some(level => level.planner !== ROOM_PLANNER_VERSION && levels.some(current => current.id === level.id && current.automaticPool));
      if (outdatedPlanner || outdatedStarterPack || snapshot.some(level => legacy.has(level.target.id))) await gameFinish(env, active);
      else return gameJSON(gameCurrent(active));
    }
  }
  const snapshot = planRooms(levels);
  const id = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO game_runs (id, player_id, token_hash, snapshot, lives, started_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, profile ? user : null, await gameHash(token), JSON.stringify(snapshot), INITIAL_LIVES, now, now + 4 * 60 * 60 * 1000).run();
  const run = await env.DB.prepare('SELECT * FROM game_runs WHERE id = ?').bind(id).first();
  return gameJSON({ ...gameCurrent(run), token }, 201);
}
async function gameAnswer(request, env, run, user) {
  const body = await gameBody(request);
  if (typeof body.requestId !== 'string' || body.requestId.length > 80 || body.requestId.length < 10) gameFail('Неверный запрос ответа.');
  if (run.last_request_id === body.requestId && run.last_result) return gameJSON(JSON.parse(run.last_result));
  if (run.status !== 'active' || body.revision !== run.revision) gameFail('Эта комната уже пройдена. Открой следующую.', 409);
  const snapshot = JSON.parse(run.snapshot), challenge = snapshot[run.round_index];
  const selected = challenge.options.findIndex(option => option.id === body.optionId); if (selected < 0) gameFail('Выбери одну из трёх картинок.');
  const correct = challenge.options[selected].id === challenge.target.id, points = scoreAnswer(run, correct);
  const nextIndex = run.round_index + 1, finished = points.lives <= 0 || nextIndex >= snapshot.length;
  const result = { runId: run.id, status: 'result', revision: run.revision + 1, round: nextIndex, total: snapshot.length,
    score: points.score, lives: points.lives, streak: points.streak, correct: points.correct, ranked: !!run.player_id, finished,
    challenge: { title: challenge.title, theme: challenge.theme, options: challenge.options },
    result: { correct, selected, gained: points.gained, correctIndex: challenge.options.findIndex(m => m.id === challenge.target.id), meme: challenge.target },
    next: gameCurrent({ ...run, ...points, round_index: nextIndex, revision: run.revision + 1, status: finished ? 'finished' : 'active' }) };
  const statements = [env.DB.prepare("UPDATE game_runs SET round_index = ?, revision = revision + 1, score = ?, streak = ?, correct = ?, lives = ?, status = ?, last_request_id = ?, last_result = ? WHERE id = ? AND revision = ? AND status = 'active'")
    .bind(nextIndex, points.score, points.streak, points.correct, points.lives, finished ? 'finished' : 'active', body.requestId, JSON.stringify(result), run.id, run.revision)];
  if (run.player_id) statements.push(env.DB.prepare('UPDATE players SET furthest_room = MAX(furthest_room, ?) WHERE id = ?').bind(nextIndex, run.player_id));
  statements.push(...gameRecordStatements(env, run.id, run.player_id));
  const changes = await env.DB.batch(statements);
  if (!changes[0].meta.changes) {
    const latest = await env.DB.prepare('SELECT last_request_id, last_result FROM game_runs WHERE id = ?').bind(run.id).first();
    if (latest.last_request_id === body.requestId) return gameJSON(JSON.parse(latest.last_result));
    gameFail('Эта комната уже пройдена. Открой следующую.', 409);
  }
  return gameJSON(result);
}
async function gameFinish(env, run) {
  await env.DB.batch([env.DB.prepare("UPDATE game_runs SET status = 'finished' WHERE id = ? AND status = 'active'").bind(run.id), ...gameRecordStatements(env, run.id, run.player_id)]);
  return gameJSON(gameCurrent(await env.DB.prepare('SELECT * FROM game_runs WHERE id = ?').bind(run.id).first()));
}

async function gameEditLevel(request, env, services, id) {
  if (!services.canManage(request, env)) gameFail('Уровни может менять только автор игры.', 403);
  const catalog = await services.catalog(); await gameSeed(env.DB, catalog.memes);
  const old = id ? await env.DB.prepare('SELECT * FROM game_levels WHERE id = ? AND active = 1').bind(id).first() : null;
  if (id && !old) gameFail('Уровень не найден.', 404);
  if (request.method === 'DELETE') {
    await env.DB.batch([env.DB.prepare('UPDATE game_levels SET active = 0 WHERE id = ?').bind(id), env.DB.prepare('UPDATE game_levels SET position = position - 1 WHERE active = 1 AND position > ?').bind(old.position)]);
    return gameJSON({ deleted: true });
  }
  const body = await gameBody(request), ids = body.optionIds;
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3 || !ids.includes(body.targetId)) gameFail('Выбери правильный мем и две разные картинки для отвлечения.');
  if (!ids.every(id => catalog.all.some(m => m.id === id))) gameFail('Один из мемов уже удалён. Обнови коллекцию.');
  const count = Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM game_levels WHERE active = 1').first()).n);
  if (!old && count >= 500) gameFail('В игре уже 500 уровней. Можно изменить существующие.');
  const position = Math.max(1, Math.min(count + Number(!old), Math.floor(Number(body.position) || count + 1)));
  const title = String(body.title || `Комната ${position}`).trim(); if (title.length > 60) gameFail('Название уровня — до 60 символов.');
  const theme = Object.hasOwn(ROOM_THEMES, body.theme) ? body.theme : 'neon';
  const statements = [];
  if (old) {
    if (position < old.position) statements.push(env.DB.prepare('UPDATE game_levels SET position = position + 1 WHERE active = 1 AND position >= ? AND position < ?').bind(position, old.position));
    if (position > old.position) statements.push(env.DB.prepare('UPDATE game_levels SET position = position - 1 WHERE active = 1 AND position > ? AND position <= ?').bind(old.position, position));
    statements.push(env.DB.prepare('UPDATE game_levels SET position = ?, title = ?, target_id = ?, option_a = ?, option_b = ?, option_c = ?, theme = ? WHERE id = ?')
      .bind(position, title, body.targetId, ids[0], ids[1], ids[2], theme, id));
  } else {
    statements.push(env.DB.prepare('UPDATE game_levels SET position = position + 1 WHERE active = 1 AND position >= ?').bind(position));
    statements.push(env.DB.prepare('INSERT INTO game_levels (id, position, title, target_id, option_a, option_b, option_c, theme, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), position, title, body.targetId, ids[0], ids[1], ids[2], theme, new Date().toISOString()));
  }
  await env.DB.batch(statements); return gameJSON({ saved: true }, old ? 200 : 201);
}

export async function handleGameApi(request, env, services) {
  if (!env.DB) return gameJSON({ error: 'Профили и уровни пока недоступны. Попробуй чуть позже.' }, 503);
  const url = new URL(request.url), pathname = url.pathname, method = request.method;
  if (method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) gameFail('Открой игру на её сайте.', 403);
  if (pathname.startsWith('/api/auth/')) return handleAccountApi(request, env, { body: gameBody });
  const identity = env.PLAYER_AUTH || await resolvePlayerIdentity(request, env);
  const user = identity.id;
  if (pathname === '/api/matches/presence') return handlePresenceApi(request, env, { user, profile: user ? await gameProfile(env.DB, user) : null, body: gameBody });
  if (pathname === '/api/matches' || pathname.startsWith('/api/matches/')) return handleMatchApi(request, env, { user, profile: await gameProfile(env.DB, user), body: gameBody, levels: () => gameLevels(env, services), shuffle: gameShuffle, plan: planRooms });
  if (pathname === '/api/duels' || pathname.startsWith('/api/duels/')) {
    return handleDuelApi(request, env, { user, profile: await gameProfile(env.DB, user), body: gameBody,
      levels: () => gameLevels(env, services), shuffle: gameShuffle, plan: planRooms });
  }
  if (pathname === '/api/me' && method === 'GET') {
    const profile = await gameProfile(env.DB, user);
    return gameJSON({ signedIn: !!user, auth: { mode: identity.kind, hasPassword: identity.hasPassword }, profile: gamePublicProfile(profile), canManage: services.canManage(request, env) });
  }
  if (pathname === '/api/profile' && method === 'PUT') return gameSaveProfile(request, env, user);
  if (pathname === '/api/leaderboard' && method === 'GET') return gameRanking(env, user);
  if (pathname === '/api/levels' && method === 'GET') {
    const manage = url.searchParams.get('manage') === '1' && services.canManage(request, env), levels = await gameLevels(env, services, manage);
    return gameJSON({ total: levels.filter(level => level.playable).length, canManage: services.canManage(request, env), levels: levels.map(level => ({ id: level.id, number: level.number,
      title: level.title, theme: level.theme, ...(manage ? { playable: level.playable, targetId: level.target_id, optionIds: [level.option_a, level.option_b, level.option_c], target: level.target } : {}) })) });
  }
  if (pathname === '/api/levels' && method === 'POST') return gameEditLevel(request, env, services);
  const level = pathname.match(/^\/api\/levels\/([a-z0-9-]+)$/i);
  if (level && ['PUT', 'DELETE'].includes(method)) return gameEditLevel(request, env, services, level[1]);
  if (pathname === '/api/runs' && method === 'POST') return gameStart(request, env, services, user);
  const runPath = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(answer|finish))?$/);
  if (runPath) {
    const run = await gameAuthorizeRun(request, env, runPath[1], user);
    if (!runPath[2] && method === 'GET') return gameJSON(gameCurrent(run));
    if (runPath[2] === 'answer' && method === 'POST') return gameAnswer(request, env, run, user);
    if (runPath[2] === 'finish' && method === 'POST') return gameFinish(env, run);
  }
  return gameJSON({ error: 'Не найдено.' }, 404);
}
