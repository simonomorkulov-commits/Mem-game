import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { LocalDB } from '../scripts/local-db.mjs';

const users = ['host', 'friend', 'third'];
function request(env, path, user = 'host', method = 'GET', body) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (user) { headers.set('oai-authenticated-user-id', user); headers.set('oai-authenticated-user-email', user + '@example.test'); }
  return worker.fetch(new Request('https://game.test' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}
async function json(response) { const r = await response; return { status: r.status, ...await r.json() }; }
async function setup() {
  const env = { DB: new LocalDB(), BUCKET: { get: async () => null, list: async () => ({ objects: [], truncated: false }) } };
  for (const user of users) assert.equal((await request(env, '/api/profile', user, 'PUT', { nickname: 'Игрок_' + user })).status, 200);
  return env;
}
async function create(env, user = 'host') { return json(request(env, '/api/duels', user, 'POST', { pack: 0 })); }
async function join(env, code, user = 'friend') { return json(request(env, '/api/duels/' + code + '/join', user, 'POST', {})); }
const get = (env, code, user = 'host') => json(request(env, '/api/duels/' + code, user));
async function row(env, code) { return env.DB.prepare('SELECT * FROM duel_rooms WHERE code = ?').bind(code).first(); }
async function ready(env, code, round) {
  await request(env, `/api/duels/${code}/ready`, 'host', 'POST', { round });
  return json(request(env, `/api/duels/${code}/ready`, 'friend', 'POST', { round }));
}
async function startNow(env, code) { await env.DB.prepare('UPDATE duel_rooms SET starts_at = ?, ends_at = ?, host_seen = ?, guest_seen = ? WHERE code = ?').bind(Date.now() - 100, Date.now() + 45000, Date.now(), Date.now(), code).run(); }
async function options(env, code) { const room = await row(env, code); return JSON.parse(room.snapshot)[room.round_index]; }
async function answer(env, code, user, optionId, requestId = crypto.randomUUID(), round = 1) {
  return json(request(env, `/api/duels/${code}/answer`, user, 'POST', { round, optionId, requestId, score: 999999 }));
}
async function next(env, code) { await env.DB.prepare('UPDATE duel_rooms SET reveal_at = ? WHERE code = ?').bind(Date.now() - 5000, code).run(); return get(env, code); }

test('Live rooms require a nickname, have two seats and hide their state from outsiders', async () => {
  const env = await setup();
  assert.equal((await request(env, '/api/duels', null, 'POST', {})).status, 401);
  assert.equal((await request(env, '/api/duels', 'unknown', 'POST', {})).status, 428);
  const packs = await json(request(env, '/api/duels/options', null)); assert.equal(packs.packs.length, 6);
  const created = await create(env); assert.equal(created.total, 5); assert.match(created.code, /^[A-Z2-9]{6}$/);
  assert.equal((await create(env)).code, created.code);
  assert.equal((await request(env, `/api/duels/${created.code}/ready`, 'host', 'POST', { round: 1 })).status, 409);
  const joined = await join(env, created.code.toLowerCase()); assert.equal(joined.opponent.nickname, 'Игрок_host');
  assert.equal((await request(env, '/api/duels/' + created.code, 'third')).status, 403);
  assert.equal((await join(env, created.code, 'third')).status, 409);
  assert.equal(JSON.stringify(joined).includes('host_id'), false);
  env.DB.close();
});

test('Two clients get one synchronized match; answers score once and are revealed only after both submit', async () => {
  const env = await setup(), created = await create(env), code = created.code; await join(env, code);
  let host = await ready(env, code, 1), friend;
  assert.equal(host.status, 'playing'); assert.ok(host.startsAt > Date.now());
  const level = await options(env, code);
  assert.equal((await answer(env, code, 'host', level.target.id)).status, 409);
  for (let round = 1; round <= 5; round++) {
    if (round > 1) await ready(env, code, round);
    await startNow(env, code); host = await get(env, code); friend = await get(env, code, 'friend');
    assert.deepEqual(host.challenge, friend.challenge);
    const challenge = await options(env, code), id = crypto.randomUUID();
    const replies = await Promise.all([answer(env, code, 'host', challenge.target.id, id, round), answer(env, code, 'host', challenge.target.id, id, round)]);
    for (const reply of replies) { assert.equal(reply.phase, 'playing'); assert.equal(reply.you.score, (round - 1) * 100); assert.equal('result' in reply, false); }
    const friendId = round === 1 ? challenge.options.find(o => o.id !== challenge.target.id).id : challenge.target.id;
    friend = await answer(env, code, 'friend', friendId, crypto.randomUUID(), round);
    assert.equal(friend.phase, 'reveal'); assert.equal(friend.you.score, (round - 1) * 100);
    host = await get(env, code); assert.equal(host.you.score, round * 100);
    await answer(env, code, 'host', friendId, crypto.randomUUID(), round);
    host = await next(env, code);
    if (round < 5) { assert.equal(host.phase, 'preparing'); assert.equal(host.round, round + 1); }
  }
  assert.equal(host.status, 'finished'); assert.equal(host.outcome, 'win'); assert.equal(host.you.score, 500); assert.equal(host.opponent.score, 400);
  friend = await get(env, code, 'friend'); assert.equal(friend.outcome, 'loss');
  await Promise.all([get(env, code), get(env, code, 'friend')]);
  const rating = await json(request(env, '/api/duels/ranking', null)); assert.equal(rating.rows.length, 2); assert.equal(rating.rows[0].wins, 1); assert.equal(rating.rows[0].played, 1);
  const campaign = await json(request(env, '/api/me')); assert.equal(campaign.profile.gamesPlayed, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM duel_seats').first()).n, 0);
  env.DB.close();
});

test('A timed-out room gets zero points for the missing answer and a draw is recorded once', async () => {
  const env = await setup(), { code } = await create(env); await join(env, code); await ready(env, code, 1);
  await env.DB.prepare('UPDATE duel_rooms SET ends_at = ? WHERE code = ?').bind(Date.now() - 1, code).run();
  const result = await get(env, code); assert.equal(result.phase, 'reveal'); assert.equal(result.result.timedOut, true);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM duel_answers').first()).n, 2);
  await env.DB.prepare("UPDATE duel_rooms SET status = 'finished', winner_id = NULL WHERE code = ?").bind(code).run();
  await Promise.all([get(env, code), get(env, code, 'friend')]);
  const rating = await json(request(env, '/api/duels/ranking', null)); assert.equal(rating.rows[0].draws, 1); assert.equal(rating.rows[0].played, 1);
  env.DB.close();
});

test('Concurrent joins and creates cannot occupy a seat in multiple rooms', async () => {
  const env = await setup();
  const [first, second] = await Promise.all([create(env), create(env)]); assert.equal(first.code, second.code);
  const results = await Promise.all([join(env, first.code, 'friend'), join(env, first.code, 'third')]);
  assert.equal(results.filter(r => r.status === 'lobby').length, 1); assert.equal(results.filter(r => r.status === 409).length, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM duel_seats').first()).n, 2);
  env.DB.close();
});

test('Leaving or disconnecting awards the opponent a win; abandoned lobbies expire without ranking changes', async () => {
  const env = await setup(), { code } = await create(env); await join(env, code); await ready(env, code, 1);
  await env.DB.prepare('UPDATE duel_rooms SET host_seen = ?, guest_seen = ? WHERE code = ?').bind(Date.now() - 91000, Date.now(), code).run();
  const result = await get(env, code, 'friend'); assert.equal(result.outcome, 'win'); assert.equal(result.reason, 'disconnected');
  const again = await create(env); await join(env, again.code); await ready(env, again.code, 1);
  const left = await json(request(env, `/api/duels/${again.code}/leave`, 'friend', 'POST', {})); assert.equal(left.outcome, 'loss');
  const lobby = await create(env); await env.DB.prepare('UPDATE duel_rooms SET expires_at = ? WHERE code = ?').bind(Date.now() - 1, lobby.code).run();
  assert.equal((await get(env, lobby.code)).status, 'cancelled');
  const rating = await json(request(env, '/api/duels/ranking', null)); assert.equal(rating.rows.find(r => r.nickname === 'Игрок_host').played, 2);
  env.DB.close();
});

test('Both players can request the same rematch without duplicating the match or its statistics', async () => {
  const env = await setup(), { code } = await create(env); await join(env, code); await ready(env, code, 1);
  await request(env, `/api/duels/${code}/leave`, 'friend', 'POST', {});
  const [a, b] = await Promise.all([json(request(env, `/api/duels/${code}/rematch`, 'host', 'POST', {})), json(request(env, `/api/duels/${code}/rematch`, 'friend', 'POST', {}))]);
  assert.equal(a.code, b.code); assert.notEqual(a.code, code); assert.equal(a.pack, 1); assert.equal(a.opponent.nickname, 'Игрок_friend');
  assert.equal((await get(env, code)).rematchCode, a.code);
  assert.equal((await join(env, a.code, 'third')).status, 409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM duel_rooms').first()).n, 2);
  const stats = await json(request(env, '/api/duels/ranking', null)); assert.equal(stats.rows[0].played, 1);
  env.DB.close();
});
