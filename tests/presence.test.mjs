import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { LocalDB } from '../scripts/local-db.mjs';
import { accountHash } from '../worker/account-api.js';

function call(env, method = 'GET', user, tabId, origin) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (user) headers.set('oai-authenticated-user-id', user);
  if (origin) headers.set('Origin', origin);
  return worker.fetch(new Request('https://game.test/api/matches/presence', { method, headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify({ tabId, playerId: 'forged' }) }) }), env);
}
async function setup() {
  const env = { DB: new LocalDB() };
  for (const id of ['one', 'two']) await env.DB.prepare('INSERT INTO players (id, nickname, nickname_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(await accountHash('player:' + id), id, id, '', '').run();
  return env;
}
const tabA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', tabB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const total = async (env) => (await (await call(env)).json()).online;
function visitor(env, visitorToken, tabId = tabA, method = 'POST', user) {
  const headers = { 'Content-Type': 'application/json', ...(user ? { 'oai-authenticated-user-id': user } : {}) };
  return worker.fetch(new Request('https://game.test/api/matches/presence', { method, headers, body: JSON.stringify({ visitorToken, tabId, playerId: 'forged' }) }), env);
}

test('Visitors without nicknames count immediately, deduplicate browser tabs and cannot remove another browser', async () => {
  const env = await setup(), tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64);
  try {
    assert.equal((await visitor(env, tokenA)).status, 200); assert.equal(await total(env), 1);
    await visitor(env, tokenA, tabB); assert.equal(await total(env), 1);
    await visitor(env, tokenB); assert.equal(await total(env), 2);
    await visitor(env, tokenA, tabA, 'DELETE'); assert.equal(await total(env), 2);
    await visitor(env, tokenA, tabB, 'DELETE'); assert.equal(await total(env), 1);
    await visitor(env, tokenA, tabA, 'DELETE'); assert.equal(await total(env), 1);
    const row = await env.DB.prepare('SELECT * FROM visitor_presence').first();
    assert.equal(row.visitor_hash.includes(tokenB), false); assert.equal(row.player_id, null);
    await visitor(env, tokenB, tabA, 'DELETE'); assert.equal(await total(env), 0);
    assert.equal((await visitor(env, '<invalid>')).status, 400);
  } finally { env.DB.close(); }
});

test('Visitor sign-in and sign-out update the same tab; known profiles deduplicate across devices and older clients', async () => {
  const env = await setup(), tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64);
  try {
    await visitor(env, tokenA); assert.equal(await total(env), 1);
    await visitor(env, tokenA, tabA, 'POST', 'one'); assert.equal(await total(env), 1);
    await visitor(env, tokenB, tabB, 'POST', 'one'); assert.equal(await total(env), 1);
    await call(env, 'POST', 'one', tabA); assert.equal(await total(env), 1);
    await visitor(env, tokenA, tabA, 'POST', 'two'); assert.equal(await total(env), 2);
    await visitor(env, tokenA, tabA, 'POST'); assert.equal(await total(env), 2);
    await visitor(env, tokenB, tabB, 'DELETE'); await call(env, 'DELETE', 'one', tabA); assert.equal(await total(env), 1);
  } finally { env.DB.close(); }
});

test('Anonymous heartbeat presence expires and cleans up after a lost connection', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793988060000 });
  const env = await setup();
  try {
    await visitor(env, 'a'.repeat(64)); t.mock.timers.tick(45000); assert.equal(await total(env), 0);
    await visitor(env, 'b'.repeat(64)); assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM visitor_presence').first()).n, 1);
  } finally { env.DB.close(); }
});

test('Online counts unique identities across tabs and only removes the departing tab', async () => {
  const env = await setup();
  try {
    assert.equal(await total(env), 0);
    for (const tab of [tabA, tabB]) assert.equal((await call(env, 'POST', 'one', tab)).status, 200);
    assert.equal(await total(env), 1);
    await call(env, 'POST', 'two', tabA); assert.equal(await total(env), 2);
    await call(env, 'DELETE', 'one', tabA); assert.equal(await total(env), 2);
    await call(env, 'DELETE', 'one', tabB); assert.equal(await total(env), 1);
    await call(env, 'DELETE', 'two', tabB); assert.equal(await total(env), 1);
    await call(env, 'DELETE', 'two', tabA); assert.equal(await total(env), 0);
    const response = await call(env); assert.deepEqual(await response.json(), { online: 0 }); assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { env.DB.close(); }
});

test('Heartbeat renews presence; missing connections expire at 45 seconds without relying on leave events', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793988000000 });
  const env = await setup();
  try {
    await call(env, 'POST', 'one', tabA); await call(env, 'POST', 'two', tabA);
    t.mock.timers.tick(30000); await call(env, 'POST', 'one', tabA);
    t.mock.timers.tick(15000); assert.equal(await total(env), 1);
    t.mock.timers.tick(30000); assert.equal(await total(env), 0);
    await call(env, 'POST', 'two', tabA);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM online_presence').first()).n, 1);
  } finally { env.DB.close(); }
});

test('Anonymous reads do not count as players; mutations require a real profile, valid tab and same origin', async () => {
  const env = await setup();
  try {
    assert.equal((await call(env, 'POST', null, tabA)).status, 401);
    assert.equal((await call(env, 'POST', 'missing', tabA)).status, 401);
    assert.equal((await call(env, 'POST', 'one', 'bad')).status, 400);
    assert.equal((await call(env, 'POST', 'one', tabA, 'https://elsewhere.test')).status, 403);
    assert.equal((await call(env, 'PUT', 'one', tabA)).status, 405);
    assert.equal(await total(env), 0);
    await call(env, 'POST', 'one', tabA);
    assert.equal((await env.DB.prepare('SELECT player_id FROM online_presence').first()).player_id, await accountHash('player:one'));
  } finally { env.DB.close(); }
});
