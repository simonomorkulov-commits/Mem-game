import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { LocalDB } from '../scripts/local-db.mjs';

class Bucket {
  values = new Map();
  async put(key, value) { this.values.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value)); }
  async get(key) { const value = this.values.get(key); return value === undefined ? null : { json: async () => JSON.parse(value), body: value }; }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key); }
  async list({ prefix }) { return { objects: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }; }
}
const setup = () => ({ DB: new LocalDB(), BUCKET: new Bucket(), MEME_ADMIN_EMAIL: 'owner@example.test' });
const owner = { id: 'owner', email: 'owner@example.test' }, visitor = { id: 'visitor', email: 'visitor@example.test' };
function call(env, path, method = 'GET', body, user = null, token) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (user) { headers.set('oai-authenticated-user-id', user.id); headers.set('oai-authenticated-user-email', user.email); }
  if (token) headers.set('X-Game-Token', token);
  return worker.fetch(new Request('https://game.test' + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
}
const payload = async response => ({ status: response.status, data: await response.json() });
async function register(env, user, nickname) { const result = await payload(await call(env, '/api/profile', 'PUT', { nickname }, user)); assert.equal(result.status, 200); return result.data; }
async function correctOption(env, runId) { const row = await env.DB.prepare('SELECT snapshot, round_index FROM game_runs WHERE id = ?').bind(runId).first(); return JSON.parse(row.snapshot)[row.round_index].target.id; }

test('Profiles require a verified identity and reserve Unicode nicknames across accounts', async () => {
  const env = setup();
  assert.equal((await call(env, '/api/profile', 'PUT', { nickname: 'Кыргыз' })).status, 401);
  await register(env, owner, 'Кыргыз');
  assert.equal((await call(env, '/api/profile', 'PUT', { nickname: 'КЫРГЫЗ' }, visitor)).status, 409);
  assert.equal((await call(env, '/api/profile', 'PUT', { nickname: '<script>' }, visitor)).status, 400);
  const me = (await payload(await call(env, '/api/me', 'GET', undefined, owner))).data;
  assert.equal(me.profile.nickname, 'Кыргыз'); assert.equal(me.signedIn, true);
  const guest = (await payload(await call(env, '/api/me'))).data; assert.equal(guest.signedIn, false);
  env.DB.close();
});

test('Thirty starter rooms are seeded once and the owner can author, reorder and delete levels', async () => {
  const env = setup();
  const initial = (await payload(await call(env, '/api/levels'))).data; assert.equal(initial.total, 30);
  assert.equal('targetId' in initial.levels[0], false);
  const rows = (await env.DB.prepare('SELECT target_id, option_a, option_b, option_c FROM game_levels').all()).results;
  assert.equal(new Set(rows.map(r => r.target_id + ':' + [r.option_a, r.option_b, r.option_c].sort().join(','))).size, 12);
  const draft = { title: 'Мой мемный уровень', position: 2, targetId: 'jai-shapka', optionIds: ['jai-shchenok', 'jai-shapka', 'jai-poklon'], theme: 'mint' };
  assert.equal((await call(env, '/api/levels', 'POST', draft, visitor)).status, 403);
  assert.equal((await call(env, '/api/levels', 'POST', draft, owner)).status, 201);
  const edited = (await payload(await call(env, '/api/levels?manage=1', 'GET', undefined, owner))).data;
  assert.equal(edited.total, 31); assert.equal(edited.levels[1].title, draft.title);
  const id = edited.levels[1].id;
  assert.equal((await call(env, '/api/levels/' + id, 'PUT', { ...draft, position: 1 }, owner)).status, 200);
  assert.equal((await call(env, '/api/levels/' + id, 'DELETE', undefined, owner)).status, 200);
  assert.equal((await payload(await call(env, '/api/levels'))).data.total, 30);
  await env.DB.prepare('DELETE FROM game_levels').run();
  assert.equal((await payload(await call(env, '/api/levels'))).data.total, 0, 'Deleted levels must not respawn');
  env.DB.close();
});

test('Server scoring rejects forged totals, deduplicates concurrent answers and records a result once', async () => {
  const env = setup(); await register(env, owner, 'МемБайке');
  const start = (await payload(await call(env, '/api/runs', 'POST', {}, owner))).data;
  assert.equal(start.total, 30); assert.equal(start.ranked, true);
  assert.equal((await call(env, '/api/runs/' + start.runId, 'GET', undefined, visitor, start.token)).status, 403);
  const answer = { requestId: crypto.randomUUID(), revision: 0, optionId: await correctOption(env, start.runId), score: 9999999 };
  const replies = await Promise.all([call(env, `/api/runs/${start.runId}/answer`, 'POST', answer, owner), call(env, `/api/runs/${start.runId}/answer`, 'POST', answer, owner)]);
  for (const reply of replies) { const result = await payload(reply); assert.equal(result.status, 200); assert.equal(result.data.score, 100); }
  assert.equal((await call(env, `/api/runs/${start.runId}/answer`, 'POST', { ...answer, requestId: crypto.randomUUID() }, owner)).status, 409);
  await call(env, `/api/runs/${start.runId}/finish`, 'POST', {}, owner);
  await call(env, `/api/runs/${start.runId}/finish`, 'POST', {}, owner);
  const ranking = (await payload(await call(env, '/api/leaderboard'))).data;
  assert.equal(ranking.rows.length, 1); assert.equal(ranking.rows[0].score, 100); assert.equal(ranking.rows[0].nickname, 'МемБайке');
  assert.equal('id' in ranking.rows[0], false); assert.equal('email' in ranking.rows[0], false);
  const me = (await payload(await call(env, '/api/me', 'GET', undefined, owner))).data; assert.equal(me.profile.gamesPlayed, 1);
  env.DB.close();
});

test('The author can still edit starter levels when the built-in collection is disabled', async () => {
  const env = setup(); await call(env, '/api/levels');
  const ids = ['custom-a', 'custom-b', 'custom-c'];
  for (const id of ids) await env.BUCKET.put('records/' + id + '.json', JSON.stringify({ id, name: id, image: '/media/' + id + '/image', audio: '/media/' + id + '/audio', custom: true, createdAt: new Date().toISOString() }));
  assert.equal((await call(env, '/api/settings', 'PUT', { includeBuiltins: false }, owner)).status, 200);
  assert.equal((await payload(await call(env, '/api/levels'))).data.total, 0);
  const managed = (await payload(await call(env, '/api/levels?manage=1', 'GET', undefined, owner))).data;
  assert.equal(managed.levels.length, 30); assert.equal(managed.levels[0].playable, false);
  const draft = { title: 'Своя комната', position: 1, targetId: ids[0], optionIds: ids, theme: 'ocean' };
  assert.equal((await call(env, '/api/levels/' + managed.levels[0].id, 'PUT', draft, owner)).status, 200);
  const available = (await payload(await call(env, '/api/levels'))).data;
  assert.equal(available.total, 1); assert.equal(available.levels[0].title, draft.title);
  env.DB.close();
});

test('Guests can play without entering the rating; registered users can resume on another device', async () => {
  const env = setup();
  const guest = (await payload(await call(env, '/api/runs', 'POST', {}))).data;
  assert.equal(guest.ranked, false);
  assert.equal((await call(env, '/api/runs/' + guest.runId)).status, 403);
  assert.equal((await call(env, '/api/runs/' + guest.runId, 'GET', undefined, null, guest.token)).status, 200);
  await call(env, `/api/runs/${guest.runId}/finish`, 'POST', {}, null, guest.token);
  assert.equal((await payload(await call(env, '/api/leaderboard'))).data.rows.length, 0);
  await register(env, visitor, 'Айгерим');
  const first = (await payload(await call(env, '/api/runs', 'POST', {}, visitor))).data;
  await call(env, `/api/runs/${first.runId}/answer`, 'POST', { requestId: crypto.randomUUID(), revision: 0, optionId: await correctOption(env, first.runId) }, visitor);
  const resumed = (await payload(await call(env, '/api/runs', 'POST', {}, visitor))).data;
  assert.equal(resumed.runId, first.runId); assert.equal(resumed.round, 2); assert.equal(resumed.score, 100);
  let run = resumed;
  for (let i = 1; i < run.total; i++) {
    run = (await payload(await call(env, `/api/runs/${run.runId}/answer`, 'POST', { requestId: crypto.randomUUID(), revision: run.revision, optionId: await correctOption(env, run.runId) }, visitor))).data;
  }
  assert.equal(run.finished, true); assert.equal(run.score, 5750);
  const profile = (await payload(await call(env, '/api/me', 'GET', undefined, visitor))).data.profile;
  assert.equal(profile.wins, 1); assert.equal(profile.gamesPlayed, 1); assert.equal(profile.bestScore, 5750);
  env.DB.close();
});

test('The Jai pack upgrades existing starter rooms once without restoring deletions or overwriting edited rooms', async () => {
  const env = setup(); await call(env, '/api/levels');
  await env.DB.prepare("DELETE FROM game_config WHERE key = 'jai-pack-v1'").run();
  await env.DB.prepare("UPDATE game_levels SET target_id = 'bruh', option_a = 'bruh', option_b = 'among-us', option_c = 'metal-pipe'").run();
  await env.DB.prepare("DELETE FROM game_levels WHERE id = 'starter-002'").run();
  await env.DB.prepare("UPDATE game_levels SET title = 'Мой уровень', target_id = 'jai-shchenok', option_a = 'jai-shchenok', option_b = 'jai-shapka', option_c = 'jai-poklon' WHERE id = 'starter-003'").run();
  const levels = (await payload(await call(env, '/api/levels'))).data; assert.equal(levels.total, 29);
  const stored = (await env.DB.prepare('SELECT * FROM game_levels').all()).results;
  assert.ok(stored.every(r => [r.target_id, r.option_a, r.option_b, r.option_c].every(id => id.startsWith('jai-'))));
  assert.equal(stored.find(r => r.id === 'starter-003').title, 'Мой уровень');
  await env.DB.prepare("DELETE FROM game_levels WHERE id = 'starter-001'").run();
  assert.equal((await payload(await call(env, '/api/levels'))).data.total, 28);
  assert.ok(await env.DB.prepare("SELECT value FROM game_config WHERE key = 'jai-pack-v1'").first()); env.DB.close();
});

test('Starting after the pack replacement saves an old run and opens a new run with only the four selected memes', async () => {
  const env = setup(); await register(env, owner, 'НоваяПодборка');
  const first = (await payload(await call(env, '/api/runs', 'POST', {}, owner))).data;
  const row = await env.DB.prepare('SELECT snapshot FROM game_runs WHERE id = ?').bind(first.runId).first(), snapshot = JSON.parse(row.snapshot);
  snapshot[0].target.id = 'bruh'; await env.DB.prepare('UPDATE game_runs SET snapshot = ?, score = 123 WHERE id = ?').bind(JSON.stringify(snapshot), first.runId).run();
  const second = (await payload(await call(env, '/api/runs', 'POST', {}, owner))).data;
  assert.notEqual(first.runId, second.runId); assert.equal(second.total, 30); assert.ok(second.challenge.target.id.startsWith('jai-'));
  assert.equal((await payload(await call(env, '/api/me', 'GET', undefined, owner))).data.profile.bestScore, 123);
  assert.equal((await env.DB.prepare('SELECT status FROM game_runs WHERE id = ?').bind(first.runId).first()).status, 'finished'); env.DB.close();
});
