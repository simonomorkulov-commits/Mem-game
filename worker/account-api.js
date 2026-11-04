const ACCOUNT_YEAR = 365 * 86400000;
const accountFail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export async function accountHash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
const accountRandom = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
function accountRawTokens(request) {
  const header = request.headers.get('X-Player-Token'), cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)mm_player=([a-f0-9]{64})(?:;|$)/)?.[1];
  return [header, cookie].filter((v, i, values) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) && values.indexOf(v) === i);
}
async function accountNative(request) { const id = request.headers.get('oai-authenticated-user-id'); return id ? accountHash('player:' + id) : null; }
function accountNativeAdmin(request, env) { const email = request.headers.get('oai-authenticated-user-email'); return !!email && !!env.MEME_ADMIN_EMAIL && email.toLowerCase() === env.MEME_ADMIN_EMAIL.toLowerCase(); }
export async function resolvePlayerIdentity(request, env) {
  if (env.DB) for (const rawToken of accountRawTokens(request)) {
    const hash = await accountHash(rawToken);
    const row = await env.DB.prepare('SELECT s.*, a.password_hash, a.is_admin, a.origin FROM player_sessions s JOIN local_accounts a ON a.player_id = s.player_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(hash, Date.now()).first();
    if (row) {
      if (row.last_seen < Date.now() - 86400000) await env.DB.prepare('UPDATE player_sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?').bind(Date.now(), Date.now() + ACCOUNT_YEAR, hash).run();
      return { id: row.player_id, kind: row.password_hash ? 'password' : 'device', hasPassword: !!row.password_hash, isAdmin: !!row.is_admin, tokenHash: hash, rawToken, origin: row.origin };
    }
  }
  const native = request.headers.get('X-Skip-Legacy') !== '1' ? await accountNative(request) : null;
  return { id: native, kind: native ? 'legacy' : 'none', hasPassword: false, isAdmin: native ? accountNativeAdmin(request, env) : false };
}
function accountNickname(value) {
  const nickname = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!/^[\p{L}\p{N}_ -]{3,20}$/u.test(nickname)) accountFail('Ник: от 3 до 20 букв, цифр, пробелов, дефисов или подчёркиваний.');
  return { nickname, key: nickname.toLowerCase() };
}
function accountPassword(value) { if (typeof value !== 'string' || value.length < 8 || value.length > 128) accountFail('Пароль: от 8 до 128 символов.'); return value; }
async function accountPasswordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function accountEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function accountLimit(env, request, action, key, limit, window) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = await accountHash(action + ':' + (key || address)), now = Date.now();
  await env.DB.prepare('INSERT INTO account_rate_limits (bucket, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END, reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END').bind(bucket, now + window, now, now).run();
  const row = await env.DB.prepare('SELECT attempts FROM account_rate_limits WHERE bucket = ?').bind(bucket).first();
  if (row.attempts > limit) accountFail('Слишком много попыток. Попробуй немного позже.', 429);
}
const accountProfile = (env, id) => env.DB.prepare('SELECT nickname, best_score, furthest_room, games_played, wins FROM players WHERE id = ?').bind(id).first();
function accountPublicProfile(p) { return p ? { nickname: p.nickname, bestScore: p.best_score, furthestRoom: p.furthest_room, gamesPlayed: p.games_played, wins: p.wins } : null; }
function accountCookie(request, token, age = Math.floor(ACCOUNT_YEAR / 1000)) { return `mm_player=${token}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }
async function accountSession(env, request, id, suppliedToken) {
  const token = suppliedToken || accountRandom(), hash = await accountHash(token), now = Date.now();
  await env.DB.prepare('INSERT INTO player_sessions (token_hash, player_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET last_seen = excluded.last_seen, expires_at = excluded.expires_at WHERE player_sessions.player_id = excluded.player_id').bind(hash, id, now, now, now + ACCOUNT_YEAR).run();
  return { token, cookie: accountCookie(request, token) };
}
async function accountResponse(env, request, id, suppliedToken) {
  const session = await accountSession(env, request, id, suppliedToken);
  return Response.json({ token: session.token, profile: accountPublicProfile(await accountProfile(env, id)) }, { headers: { 'Set-Cookie': session.cookie, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function accountRetain(env, request, identity) {
  const native = await accountNative(request);
  if (!native || (identity.kind !== 'legacy' && identity.id !== native)) accountFail('Нет доступа к прежнему профилю.', 403);
  if (!await accountProfile(env, native)) accountFail('Сначала выбери ник.', 428);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO local_accounts (player_id, is_admin, origin, created_at, updated_at) VALUES (?, ?, 'legacy', ?, ?) ON CONFLICT(player_id) DO UPDATE SET is_admin = MAX(is_admin, excluded.is_admin), updated_at = excluded.updated_at").bind(native, Number(accountNativeAdmin(request, env)), now, now).run();
  return accountResponse(env, request, native);
}
async function accountGuest(env, request, identity, body) {
  if (identity.id && await accountProfile(env, identity.id)) {
    if (identity.kind === 'legacy') return accountRetain(env, request, identity);
    return accountResponse(env, request, identity.id, identity.rawToken);
  }
  const name = accountNickname(body.nickname);
  const password = body.password ? accountPassword(body.password) : null;
  await accountLimit(env, request, 'create', null, 50, 3600000);
  if (await env.DB.prepare('SELECT id FROM players WHERE nickname_key = ?').bind(name.key).first()) accountFail('Этот ник уже занят. Если это твой профиль, войди по нику и паролю.', 409);
  const id = identity.kind === 'legacy' ? identity.id : 'device:' + crypto.randomUUID(), now = Date.now();
  const salt = password ? crypto.randomUUID() : null, hash = password ? await accountPasswordHash(password, salt) : null;
  const clientToken = accountRawTokens(request)[0], token = clientToken && !await env.DB.prepare('SELECT token_hash FROM player_sessions WHERE token_hash = ?').bind(await accountHash(clientToken)).first() ? clientToken : accountRandom();
  try { await env.DB.batch([
    env.DB.prepare('INSERT INTO players (id, nickname, nickname_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, name.nickname, name.key, new Date(now).toISOString(), new Date(now).toISOString()),
    env.DB.prepare('INSERT INTO local_accounts (player_id, password_hash, password_salt, is_admin, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, hash, salt, Number(identity.kind === 'legacy' && accountNativeAdmin(request, env)), identity.kind === 'legacy' ? 'legacy' : 'guest', now, now),
    env.DB.prepare('INSERT INTO player_sessions (token_hash, player_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await accountHash(token), id, now, now, now + ACCOUNT_YEAR)
  ]); }
  catch (error) {
    const saved = await resolvePlayerIdentity(request, env);
    if (saved.id && saved.rawToken && await accountProfile(env, saved.id)) return accountResponse(env, request, saved.id, saved.rawToken);
    if (/UNIQUE/i.test(error.message)) accountFail('Этот ник уже занят. Выбери другой или войди с паролем.', 409); throw error;
  }
  return accountResponse(env, request, id, token);
}
async function accountLogin(env, request, body) {
  const name = accountNickname(body.nickname);
  if (typeof body.password !== 'string' || body.password.length > 128) accountFail('Укажи ник и пароль.');
  await accountLimit(env, request, 'login-ip', null, 100, 900000);
  await accountLimit(env, request, 'login-name', name.key, 10, 900000);
  const row = await env.DB.prepare('SELECT a.* FROM local_accounts a JOIN players p ON p.id = a.player_id WHERE p.nickname_key = ?').bind(name.key).first();
  const actual = await accountPasswordHash(body.password, row?.password_salt || 'meme-game-missing-account');
  if (!row?.password_hash || !accountEqual(actual, row.password_hash)) accountFail('Неверный ник или пароль.', 401);
  return accountResponse(env, request, row.player_id);
}
async function accountSetPassword(env, request, identity, body) {
  if (!identity.id || !await accountProfile(env, identity.id)) accountFail('Сначала сохрани ник.', 401);
  await accountLimit(env, request, 'password', identity.id, 10, 3600000);
  const password = accountPassword(body.password), previous = await env.DB.prepare('SELECT * FROM local_accounts WHERE player_id = ?').bind(identity.id).first();
  if (previous?.password_hash) {
    if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 128 || !accountEqual(await accountPasswordHash(body.currentPassword, previous.password_salt), previous.password_hash)) accountFail('Текущий пароль неверный.', 401);
  }
  const salt = crypto.randomUUID(), hash = await accountPasswordHash(password, salt), token = accountRandom(), now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO local_accounts (player_id, password_hash, password_salt, is_admin, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt, updated_at = excluded.updated_at").bind(identity.id, hash, salt, Number(identity.kind === 'legacy' && accountNativeAdmin(request, env)), identity.kind === 'legacy' ? 'legacy' : 'guest', now, now),
    env.DB.prepare('DELETE FROM player_sessions WHERE player_id = ?').bind(identity.id),
    env.DB.prepare('INSERT INTO player_sessions (token_hash, player_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await accountHash(token), identity.id, now, now, now + ACCOUNT_YEAR)
  ]);
  return accountResponse(env, request, identity.id, token);
}
async function accountLogout(env, request, identity) {
  if (identity.tokenHash) await env.DB.prepare('DELETE FROM player_sessions WHERE token_hash = ?').bind(identity.tokenHash).run();
  return Response.json({ signedOut: true }, { headers: { 'Set-Cookie': accountCookie(request, '', 0), 'Cache-Control': 'no-store' } });
}
export async function handleAccountApi(request, env, services) {
  const path = new URL(request.url).pathname;
  if (!['POST', 'PUT'].includes(request.method)) accountFail('Не найдено.', 404);
  const identity = env.PLAYER_AUTH || await resolvePlayerIdentity(request, env);
  if (path === '/api/auth/guest' && request.method === 'POST') return accountGuest(env, request, identity, await services.body(request));
  if (path === '/api/auth/login' && request.method === 'POST') return accountLogin(env, request, await services.body(request));
  if (path === '/api/auth/password' && request.method === 'PUT') return accountSetPassword(env, request, identity, await services.body(request));
  if (path === '/api/auth/retain' && request.method === 'POST') return accountRetain(env, request, identity);
  if (path === '/api/auth/logout' && request.method === 'POST') return accountLogout(env, request, identity);
  accountFail('Не найдено.', 404);
}
