import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { LocalDB } from '../scripts/local-db.mjs';

const setup = () => ({ DB: new LocalDB(), BUCKET: { get: async () => null, list: async () => ({ objects: [], truncated: false }) }, MEME_ADMIN_EMAIL: 'owner@example.test' });
function call(env, path, method = 'GET', body, token, extras = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', ...extras });
  if (token) headers.set('X-Player-Token', token);
  return worker.fetch(new Request('https://game.test' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}
async function payload(response) { const r = await response; return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') }; }
async function guest(env, nickname = 'МемБайке', token) { const result = await payload(call(env, '/api/auth/guest', 'POST', { nickname }, token)); assert.equal(result.status, 200); return result.data; }
const me = (env, token, extras) => payload(call(env, '/api/me', 'GET', undefined, token, extras));

test('A nickname creates a persistent device identity; the same cookie or token restores the saved profile', async () => {
  const env = setup(), token = 'a'.repeat(64);
  const response = await payload(call(env, '/api/auth/guest', 'POST', { nickname: '  Кыргыз  ' }, token));
  assert.equal(response.status, 200); assert.equal(response.data.token, token); assert.equal(response.data.profile.nickname, 'Кыргыз');
  assert.match(response.cookie, /HttpOnly/); assert.match(response.cookie, /Max-Age=31536000/); assert.match(response.cookie, /Secure/);
  const stored = await env.DB.prepare('SELECT * FROM player_sessions').first(); assert.notEqual(stored.token_hash, token);
  const cookieOnly = await me(env, null, { Cookie: 'mm_player=' + token }); assert.equal(cookieOnly.data.profile.nickname, 'Кыргыз'); assert.equal(cookieOnly.data.auth.mode, 'device');
  const restarted = await me(env, token); assert.equal(restarted.data.profile.nickname, 'Кыргыз'); assert.equal(restarted.data.canManage, false);
  assert.equal((await me(env)).data.profile, null); assert.equal('id' in restarted.data.profile, false);
  env.DB.close();
});

test('Nickname creation retries are idempotent; another device cannot claim or sign into an existing nickname', async () => {
  const env = setup(), token = 'b'.repeat(64);
  const replies = await Promise.all([call(env, '/api/auth/guest', 'POST', { nickname: 'Азамат' }, token), call(env, '/api/auth/guest', 'POST', { nickname: 'Азамат' }, token)]);
  for (const reply of replies) assert.equal(reply.status, 200);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first()).n, 1);
  const other = await payload(call(env, '/api/auth/guest', 'POST', { nickname: 'АЗАМАТ' }, 'c'.repeat(64))); assert.equal(other.status, 409);
  assert.equal((await call(env, '/api/profile', 'PUT', { nickname: 'Азамат' })).status, 401);
  assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'Азамат', password: 'guess1234' })).status, 401);
  assert.equal((await me(env, token)).data.profile.nickname, 'Азамат'); env.DB.close();
});

test('Adding a password preserves records, enables another device and invalidates previous sessions', async () => {
  const env = setup(), created = await guest(env), original = await env.DB.prepare('SELECT id FROM players WHERE nickname = ?').bind('МемБайке').first();
  await env.DB.prepare('UPDATE players SET best_score = 450, games_played = 2 WHERE id = ?').bind(original.id).run();
  const saved = await payload(call(env, '/api/auth/password', 'PUT', { password: 'test-password-123' }, created.token));
  assert.equal(saved.status, 200); assert.notEqual(saved.data.token, created.token);
  assert.equal((await me(env, created.token)).data.signedIn, false);
  const stored = await env.DB.prepare('SELECT * FROM local_accounts WHERE player_id = ?').bind(original.id).first(); assert.notEqual(stored.password_hash, 'test-password-123'); assert.equal(stored.password_hash.length, 64);
  const login = await payload(call(env, '/api/auth/login', 'POST', { nickname: 'МЕМБАЙКЕ', password: 'test-password-123' }));
  assert.equal(login.status, 200); assert.equal(login.data.profile.bestScore, 450); assert.equal(login.data.profile.gamesPlayed, 2);
  assert.equal((await me(env, login.data.token)).data.auth.hasPassword, true);
  assert.equal((await call(env, '/api/auth/logout', 'POST', {}, login.data.token)).status, 200);
  assert.equal((await me(env, login.data.token)).data.signedIn, false); assert.equal((await me(env, saved.data.token)).data.signedIn, true);
  env.DB.close();
});

test('Changing a protected password requires the old password and revokes all other devices', async () => {
  const env = setup(), first = await guest(env, 'Дос');
  const password = await payload(call(env, '/api/auth/password', 'PUT', { password: 'password-one' }, first.token));
  const second = await payload(call(env, '/api/auth/login', 'POST', { nickname: 'Дос', password: 'password-one' }));
  assert.equal((await call(env, '/api/auth/password', 'PUT', { password: 'password-two', currentPassword: 'wrong' }, password.data.token)).status, 401);
  const changed = await payload(call(env, '/api/auth/password', 'PUT', { password: 'password-two', currentPassword: 'password-one' }, password.data.token)); assert.equal(changed.status, 200);
  assert.equal((await me(env, second.data.token)).data.signedIn, false); assert.equal((await me(env, password.data.token)).data.signedIn, false);
  assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'Дос', password: 'password-one' })).status, 401);
  assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'Дос', password: 'password-two' })).status, 200);
  assert.equal((await me(env, changed.data.token)).data.profile.nickname, 'Дос'); env.DB.close();
});

test('Legacy owners keep their nickname, records and author access without giving author rights to guests', async () => {
  const env = setup(), owner = { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test' };
  await call(env, '/api/profile', 'PUT', { nickname: 'АвторМемов' }, null, owner);
  await env.DB.prepare('UPDATE players SET best_score = 777').run();
  const retained = await payload(call(env, '/api/auth/retain', 'POST', {}, null, owner)); assert.equal(retained.status, 200);
  const restored = await me(env, retained.data.token); assert.equal(restored.data.profile.nickname, 'АвторМемов'); assert.equal(restored.data.profile.bestScore, 777); assert.equal(restored.data.canManage, true);
  const draft = { title: 'Комната автора', targetId: 'bruh', optionIds: ['bruh', 'among-us', 'metal-pipe'], position: 1, theme: 'mint' };
  assert.equal((await call(env, '/api/levels', 'POST', draft, retained.data.token)).status, 201);
  const attacker = await payload(call(env, '/api/auth/guest', 'POST', { nickname: 'ПростоИгрок', isAdmin: true, is_admin: 1, player_id: 'owner' }));
  assert.equal(attacker.status, 200); assert.equal((await me(env, attacker.data.token)).data.canManage, false);
  assert.equal((await call(env, '/api/levels', 'POST', draft, attacker.data.token)).status, 403);
  assert.equal((await call(env, '/api/auth/retain', 'POST', {}, attacker.data.token, owner)).status, 403);
  env.DB.close();
});

test('Expired tokens and cross-origin writes cannot modify accounts; failed logins are limited', async () => {
  const env = setup(), created = await guest(env, 'Айгерим');
  const account = await payload(call(env, '/api/auth/password', 'PUT', { password: 'good-password' }, created.token));
  await env.DB.prepare('UPDATE player_sessions SET expires_at = ?').bind(Date.now() - 1).run();
  assert.equal((await me(env, account.data.token)).data.signedIn, false);
  assert.equal((await call(env, '/api/auth/guest', 'POST', { nickname: 'Чужой' }, null, { Origin: 'https://other.test' })).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'Айгерим', password: 'bad-password' })).status, 401);
  assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'Айгерим', password: 'good-password' })).status, 429);
  await env.DB.prepare('UPDATE account_rate_limits SET reset_at = ?').bind(Date.now() - 1).run();
  assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'Айгерим', password: 'good-password' })).status, 200); env.DB.close();
});

test('Renaming a protected profile keeps its records and makes the new nickname usable for login', async () => {
  const env = setup(), created = await guest(env, 'СтарыйНик');
  const saved = await payload(call(env, '/api/auth/password', 'PUT', { password: 'nickname-password' }, created.token));
  assert.equal((await call(env, '/api/profile', 'PUT', { nickname: 'НовыйНик' }, saved.data.token)).status, 200);
  assert.equal((await call(env, '/api/auth/login', 'POST', { nickname: 'СтарыйНик', password: 'nickname-password' })).status, 401);
  const login = await payload(call(env, '/api/auth/login', 'POST', { nickname: 'НовыйНик', password: 'nickname-password' })); assert.equal(login.status, 200); assert.equal(login.data.profile.nickname, 'НовыйНик');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first()).n, 1); env.DB.close();
});
