import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { LocalDB } from '../scripts/local-db.mjs';

const ids = ['one', 'two', 'three', 'four', 'five', 'six'];
function call(env, path, user = 'one', method = 'GET', body) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (user) { headers.set('oai-authenticated-user-id', user); headers.set('oai-authenticated-user-email', user + '@example.test'); }
  return worker.fetch(new Request('https://game.test' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}
async function payload(response) { const r = await response; return { status: r.status, data: await r.json() }; }
async function setup() {
  const env = { DB: new LocalDB(), BUCKET: { get: async () => null, list: async () => ({ objects: [], truncated: false }) } };
  for (const user of ids) assert.equal((await call(env, '/api/profile', user, 'PUT', { nickname: 'Мем_' + user })).status, 200);
  return env;
}
async function create(env, options = {}) { const r = await payload(call(env, '/api/matches', 'one', 'POST', { title: 'Тестовая комната', ...options })); assert.equal(r.status, 201); return r.data; }
async function join(env, id, user, password) { return payload(call(env, `/api/matches/${id}/join`, user, 'POST', { password })); }
async function view(env, id, user = 'one') { const r = await payload(call(env, '/api/matches/' + id, user)); assert.equal(r.status, 200); return r.data; }
async function row(env, id) { return env.DB.prepare('SELECT * FROM match_rooms WHERE id = ?').bind(id).first(); }
async function ready(env, id, users, round = 1) { for (const user of users) assert.equal((await call(env, `/api/matches/${id}/ready`, user, 'POST', { round })).status, 200); }
async function four(env) { const room = await create(env); for (const user of ids.slice(1, 4)) assert.equal((await join(env, room.id, user)).status, 200); return room; }
async function start(env, id, users = ids.slice(0, 4)) { await ready(env, id, users); const result = await payload(call(env, `/api/matches/${id}/start`, 'one', 'POST', {})); assert.equal(result.status, 200); return result.data; }
async function now(env, id) { await env.DB.prepare('UPDATE match_rooms SET starts_at = ?, ends_at = ? WHERE id = ?').bind(Date.now() - 100, Date.now() + 45000, id).run(); }
async function challenge(env, id) { const r = await row(env, id); return JSON.parse(r.snapshot)[r.round_index]; }
async function answer(env, id, user, optionId, round = 1, requestId = crypto.randomUUID()) { return payload(call(env, `/api/matches/${id}/answer`, user, 'POST', { optionId, round, requestId, score: 999999 })); }
async function next(env, id) { await env.DB.prepare('UPDATE match_rooms SET reveal_at = ? WHERE id = ?').bind(Date.now() - 5000, id).run(); return view(env, id); }

test('Password rooms verify a salted hash, do not expose secrets, and retain access after joining', async () => {
  const env = await setup(), password = 'Друзья_123', room = await create(env, { password });
  const stored = await row(env, room.id); assert.notEqual(stored.password_hash, password); assert.equal(stored.password_hash.length, 64);
  const listed = (await payload(call(env, '/api/matches/rooms', null))).data.rooms[0]; assert.equal(listed.locked, true);
  const preview = (await payload(call(env, `/api/matches/${room.id}/preview`, null))).data;
  for (const value of [room, listed, preview]) { const text = JSON.stringify(value); assert.equal(text.includes(password), false); assert.equal(text.includes('password_hash'), false); assert.equal(text.includes('password_salt'), false); }
  assert.equal((await join(env, room.id, 'two')).status, 403); assert.equal((await join(env, room.id, 'two', 'wrong')).status, 403);
  assert.equal((await join(env, room.id, 'two', password)).status, 200); assert.equal((await view(env, room.id, 'two')).you.nickname, 'Мем_two');
  assert.equal((await call(env, '/api/matches/' + room.id, 'three')).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await join(env, room.id, 'three', 'wrong')).status, 403);
  assert.equal((await join(env, room.id, 'three', password)).status, 429);
  await env.DB.prepare('UPDATE match_password_attempts SET updated_at = ?').bind(Date.now() - 301000).run();
  assert.equal((await join(env, room.id, 'three', password)).status, 200); env.DB.close();
});

test('Concurrent joins stop at four players; only the host starts after all are ready', async () => {
  const env = await setup(), room = await create(env);
  assert.equal((await call(env, '/api/matches', null, 'POST', {})).status, 401);
  const replies = await Promise.all(ids.slice(1).map(user => join(env, room.id, user)));
  assert.equal(replies.filter(r => r.status === 200).length, 3); assert.equal(replies.filter(r => r.status === 409).length, 2);
  const members = (await env.DB.prepare('SELECT m.player_id, p.nickname FROM match_members m JOIN players p ON p.id = m.player_id WHERE room_id = ?').bind(room.id).all()).results;
  const admitted = ids.filter(id => members.some(m => m.nickname === 'Мем_' + id));
  assert.equal((await payload(call(env, '/api/matches/rooms', null))).data.rooms.length, 0);
  assert.equal((await call(env, `/api/matches/${room.id}/start`, 'one', 'POST', {})).status, 409);
  assert.equal((await call(env, `/api/matches/${room.id}/start`, admitted[1], 'POST', {})).status, 403);
  await ready(env, room.id, admitted); const lobby = await view(env, room.id); assert.equal(lobby.status, 'lobby'); assert.equal(lobby.canStart, true);
  const started = await payload(call(env, `/api/matches/${room.id}/start`, 'one', 'POST', {})); assert.equal(started.data.status, 'playing'); assert.ok(started.data.startsAt > Date.now());
  const extra = ids.find(id => !admitted.includes(id)); assert.equal((await join(env, room.id, extra)).status, 409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM match_seats').first()).n, 4); env.DB.close();
});

test('Four players race independently through the same five rooms; scores and one winner are recorded once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793901600000 });
  const env = await setup(), { id } = await four(env); await start(env, id);
  const track = JSON.parse((await row(env, id)).snapshot); t.mock.timers.tick(3500);
  for (const user of ids.slice(1, 4)) assert.deepEqual((await view(env, id, user)).challenge, (await view(env, id)).challenge);
  for (let i = 0; i < 4; i++) for (let round = 1; round <= 5; round++) {
    t.mock.timers.tick(2000);
    const target = track[round - 1], wrong = target.options.find(o => o.id !== target.target.id).id, requestId = crypto.randomUUID();
    const replies = await Promise.all([answer(env, id, ids[i], round <= i ? wrong : target.target.id, round, requestId), answer(env, id, ids[i], round <= i ? wrong : target.target.id, round, requestId)]);
    for (const reply of replies) { assert.equal(reply.status, 200); assert.equal(reply.data.phase, 'playing'); assert.equal(reply.data.you.completed, round); }
    if (i === 0) {
      assert.equal(replies[0].data.you.score, round * 145);
      const other = await view(env, id, 'two'); assert.equal(other.round, 1); assert.equal('result' in other, false);
      assert.equal(other.players[0].completed, round); assert.equal(other.players[0].score, round * 145);
      if (round < 5) { assert.equal(replies[0].data.round, round + 1); assert.deepEqual(replies[0].data.challenge.options, track[round].options); }
      else { assert.equal(replies[0].data.status, 'playing'); assert.equal(replies[0].data.you.finished, true); }
    }
  }
  const state = await view(env, id);
  assert.equal(state.status, 'finished'); assert.equal(state.you.outcome, 'win'); assert.deepEqual(state.players.map(p => p.correct), [5, 4, 3, 2]); assert.equal(state.you.score, 725);
  await Promise.all(ids.slice(0, 4).map(user => view(env, id, user)));
  const stats = (await env.DB.prepare('SELECT * FROM duel_stats').all()).results; assert.equal(stats.length, 4); assert.equal(stats.filter(s => s.wins === 1).length, 1); assert.ok(stats.every(s => s.played === 1));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM match_seats').first()).n, 0);
  const profile = (await payload(call(env, '/api/me'))).data.profile; assert.equal(profile.gamesPlayed, 0); env.DB.close();
});

test('An exact tie in score and finish time awards draws only to tied leaders', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793901600000 });
  const env = await setup(), { id } = await four(env), stored = await row(env, id);
  await env.DB.prepare('UPDATE match_rooms SET snapshot = ? WHERE id = ?').bind(JSON.stringify(JSON.parse(stored.snapshot).slice(0, 1)), id).run();
  await start(env, id); t.mock.timers.tick(7500); const target = await challenge(env, id), wrong = target.options.find(o => o.id !== target.target.id).id;
  for (let i = 0; i < 4; i++) await answer(env, id, ids[i], i < 2 ? target.target.id : wrong);
  const final = await view(env, id); assert.deepEqual(final.players.map(p => p.outcome), ['draw', 'draw', 'loss', 'loss']);
  const stats = (await env.DB.prepare('SELECT * FROM duel_stats').all()).results; assert.equal(stats.reduce((n, s) => n + s.wins, 0), 0); assert.equal(stats.reduce((n, s) => n + s.draws, 0), 2); env.DB.close();
});

test('A departing player does not stop the remaining three; the last active player wins', async () => {
  const env = await setup(), { id } = await four(env); await start(env, id); await now(env, id);
  await call(env, `/api/matches/${id}/leave`, 'four', 'POST', {}); let state = await view(env, id); assert.equal(state.count, 3); assert.equal(state.status, 'playing');
  const target = await challenge(env, id); for (const user of ids.slice(0, 3)) await answer(env, id, user, target.target.id);
  state = await view(env, id); assert.equal(state.phase, 'playing'); assert.equal(state.round, 2);
  await call(env, `/api/matches/${id}/leave`, 'three', 'POST', {}); await call(env, `/api/matches/${id}/leave`, 'two', 'POST', {});
  state = await view(env, id); assert.equal(state.status, 'finished'); assert.equal(state.you.outcome, 'win'); assert.equal(state.players.filter(p => p.active).length, 1);
  const stats = (await env.DB.prepare('SELECT * FROM duel_stats').all()).results; assert.equal(stats.length, 4); assert.ok(stats.every(s => s.played === 1)); env.DB.close();
});

test('Lobby ownership transfers on exit and empty lobbies cancel without recording games', async () => {
  const env = await setup(), { id } = await four(env); await call(env, `/api/matches/${id}/leave`, 'one', 'POST', {});
  const room = await view(env, id, 'two'); assert.equal(room.isHost, true); assert.equal(room.count, 3);
  for (const user of ids.slice(1, 4)) await call(env, `/api/matches/${id}/leave`, user, 'POST', {});
  assert.equal((await row(env, id)).status, 'cancelled'); assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM duel_stats').first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM match_seats').first()).n, 0); env.DB.close();
});

test('Four-player rematches are shared, reserved and do not duplicate results', async () => {
  const env = await setup(), { id } = await four(env); await start(env, id);
  for (const user of ids.slice(1, 4)) await call(env, `/api/matches/${id}/leave`, user, 'POST', {});
  const [first, second] = await Promise.all([payload(call(env, `/api/matches/${id}/rematch`, 'one', 'POST', {})), payload(call(env, `/api/matches/${id}/rematch`, 'two', 'POST', {}))]);
  assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(first.data.id, second.data.id); assert.equal(first.data.players.length, 4);
  assert.equal((await join(env, first.data.id, 'five')).status, 403);
  assert.equal((await payload(call(env, '/api/matches/rooms', null))).data.rooms.length, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM match_rooms').first()).n, 2);
  assert.ok((await env.DB.prepare('SELECT played FROM duel_stats').all()).results.every(r => r.played === 1)); env.DB.close();
});

test('Speed bonuses use server time, reject early or skipped rooms, and cannot be forged or duplicated', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793901600000 });
  const env = await setup(), room = await create(env); await join(env, room.id, 'two'); const started = await start(env, room.id, ['one', 'two']);
  assert.equal(started.mode, 'race'); const target = started.challenge.target.id;
  assert.equal((await answer(env, room.id, 'one', target)).status, 409);
  t.mock.timers.tick(5500);
  assert.equal((await answer(env, room.id, 'one', target, 2)).status, 409);
  const requestId = crypto.randomUUID();
  const result = await payload(call(env, `/api/matches/${room.id}/answer`, 'one', 'POST', { round: 1, optionId: target, requestId, score: 999999, speedBonus: 999, elapsedMs: -10000, answeredAt: 0 }));
  assert.equal(result.status, 200); assert.equal(result.data.result.gained, 145); assert.equal(result.data.result.speedBonus, 45); assert.equal(result.data.result.elapsedMs, 2000);
  assert.equal(result.data.round, 2); assert.equal(result.data.startsAt, Date.now()); assert.equal((await view(env, room.id, 'two')).round, 1);
  t.mock.timers.tick(10000); const slower = await answer(env, room.id, 'two', target); assert.equal(slower.data.result.gained, 120);
  const retried = await answer(env, room.id, 'one', target, 1, requestId); assert.equal(retried.status, 200); assert.equal(retried.data.you.score, 145); assert.equal(retried.data.you.completed, 1);
  const level = retried.data.challenge, other = level.options.find(o => o.id !== level.target.id).id;
  const raced = await Promise.all([answer(env, room.id, 'one', level.target.id, 2), answer(env, room.id, 'one', other, 2)]);
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  assert.equal((await view(env, room.id)).you.completed, 2);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM match_answers').first()).n, 3); env.DB.close();
});

test('Equal scores are decided by the earlier finish; finishing first does not declare a win before other players finish', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793901600000 });
  const env = await setup(), room = await create(env); await join(env, room.id, 'two');
  await env.DB.prepare('UPDATE match_rooms SET snapshot = ? WHERE id = ?').bind(JSON.stringify(JSON.parse((await row(env, room.id)).snapshot).slice(0, 1)), room.id).run();
  const started = await start(env, room.id, ['one', 'two']); t.mock.timers.tick(23500);
  const first = await answer(env, room.id, 'one', started.challenge.target.id); assert.equal(first.data.you.score, 100); assert.equal(first.data.you.finished, true); assert.equal(first.data.status, 'playing');
  assert.equal(first.data.challenge, null); assert.equal((await payload(call(env, '/api/matches/current'))).data.room.you.finished, true);
  t.mock.timers.tick(2000); const last = await answer(env, room.id, 'two', started.challenge.target.id);
  assert.equal(last.data.status, 'finished'); assert.deepEqual(last.data.players.map(p => p.score), [100, 100]); assert.deepEqual(last.data.players.map(p => p.outcome), ['win', 'loss']);
  assert.deepEqual(last.data.players.map(p => p.elapsedMs), [20000, 22000]); env.DB.close();
});

test('Timeouts move each racer forward immediately and a fully timed-out connected race records one draw', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793901600000 });
  const env = await setup(), room = await create(env); await join(env, room.id, 'two'); await start(env, room.id, ['one', 'two']); t.mock.timers.tick(3500);
  for (let i = 1; i <= 5; i++) {
    t.mock.timers.tick(45000); const state = await view(env, room.id); await view(env, room.id, 'two');
    assert.equal(state.you.completed, i); assert.equal(state.you.score, 0); assert.equal(state.result.timedOut, true);
    if (i < 5) { assert.equal(state.round, i + 1); assert.equal(state.startsAt, Date.now()); assert.equal(state.phase, 'playing'); }
    else { assert.equal(state.status, 'finished'); assert.equal(state.you.outcome, 'draw'); }
  }
  const again = await view(env, room.id); assert.equal(again.you.elapsedMs, 225000);
  const stats = (await env.DB.prepare('SELECT * FROM duel_stats').all()).results; assert.ok(stats.every(s => s.played === 1 && s.draws === 1)); env.DB.close();
});

test('A racer who has finished keeps the result after disconnecting while slower racers continue', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1793901600000 });
  const env = await setup(), room = await create(env); await join(env, room.id, 'two'); await start(env, room.id, ['one', 'two']); t.mock.timers.tick(3500);
  let state = await view(env, room.id);
  for (let round = 1; round <= 5; round++) { t.mock.timers.tick(1000); state = (await answer(env, room.id, 'one', state.challenge.target.id, round)).data; }
  assert.equal(state.you.finished, true); t.mock.timers.tick(95000);
  await env.DB.prepare('UPDATE match_members SET seen_at = ? WHERE room_id = ? AND slot = 1').bind(Date.now(), room.id).run();
  const slower = await view(env, room.id, 'two'); assert.equal(slower.status, 'playing'); assert.equal(slower.players[0].active, true); assert.equal(slower.players[0].finished, true); assert.equal(slower.round, 3);
  while (!slower.you.finished) {
    state = await view(env, room.id, 'two'); if (state.you.finished) break;
    t.mock.timers.tick(1000); const reply = await answer(env, room.id, 'two', state.challenge.target.id, state.round); if (reply.data.you.finished) break;
  }
  assert.equal((await view(env, room.id, 'two')).players[0].outcome, 'win'); env.DB.close();
});

test('Previously started classic rooms retain their reveal flow and rematches use the new race rules', async () => {
  const env = await setup(), room = await create(env); await join(env, room.id, 'two');
  await env.DB.prepare("UPDATE match_rooms SET mode = 'classic', snapshot = ? WHERE id = ?").bind(JSON.stringify(JSON.parse((await row(env, room.id)).snapshot).slice(0, 1)), room.id).run();
  const started = await start(env, room.id, ['one', 'two']); await now(env, room.id);
  await answer(env, room.id, 'one', started.challenge.target.id); await answer(env, room.id, 'two', started.challenge.target.id);
  assert.equal((await view(env, room.id)).phase, 'reveal'); const finished = await next(env, room.id); assert.equal(finished.status, 'finished');
  const rematch = await payload(call(env, `/api/matches/${room.id}/rematch`, 'one', 'POST', {})); assert.equal(rematch.data.mode, 'race'); env.DB.close();
});
