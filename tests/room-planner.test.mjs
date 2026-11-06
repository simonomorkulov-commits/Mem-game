import test from 'node:test';
import assert from 'node:assert/strict';
import { planRooms } from '../worker/room-planner.js';
function rng(seed) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
function fixture(n, count = 30) {
  const pool = Array.from({ length: n }, (_, i) => ({ id: 'meme-' + i, audio: '/audio-' + i, image: '/image-' + i }));
  return Array.from({ length: count }, (_, i) => ({ id: 'starter-' + i, title: 'Room ' + i, theme: 'neon', target: pool[i % n], options: pool.slice(0, 3), automaticPool: pool }));
}
test('Nine-meme rounds have three completely different pictures and all sounds appear once in each nine-room bag', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rounds = planRooms(fixture(9), rng(seed));
    for (let i = 0; i < rounds.length; i++) {
      const ids = rounds[i].options.map(m => m.id); assert.equal(new Set(ids).size, 3); assert.equal(ids.filter(id => id === rounds[i].target.id).length, 1);
      if (i) { assert.equal(ids.filter(id => rounds[i - 1].options.some(m => m.id === id)).length, 0); assert.notEqual(rounds[i].target.id, rounds[i - 1].target.id); }
    }
    for (let i = 0; i < 27; i += 9) assert.equal(new Set(rounds.slice(i, i + 9).map(r => r.target.id)).size, 9);
  }
});
test('The planner scales to larger collections, uses added memes, and does not depend on a fixed set of nine', () => {
  for (const size of [10, 20, 100]) {
    const rounds = planRooms(fixture(size, size * 2), rng(size));
    assert.equal(new Set(rounds.slice(0, size).map(r => r.target.id)).size, size);
    assert.equal(new Set(rounds.slice(size).map(r => r.target.id)).size, size);
    for (let i = 1; i < rounds.length; i++) assert.ok(rounds[i].options.every(m => !rounds[i - 1].options.some(p => p.id === m.id)));
  }
});
test('New games change target order and correct-door positions without leaving any permanently repeated distractor', () => {
  const a = planRooms(fixture(9), rng(12)), b = planRooms(fixture(9), rng(65));
  assert.notDeepEqual(a.map(r => r.target.id), b.map(r => r.target.id));
  assert.equal(new Set(a.map(r => r.options.findIndex(m => m.id === r.target.id))).size, 3);
  assert.equal(a.map(r => r.options.map(m => m.id)).reduce((common, ids) => common.filter(id => ids.includes(id))).length, 0);
});
test('Author-selected rooms keep the exact chosen target and set of pictures, including between automatic blocks', () => {
  const levels = fixture(9), custom = { id: 'authored', title: 'Author choice', theme: 'mint', target: { id: 'x' }, options: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] };
  levels.splice(5, 0, custom); const rounds = planRooms(levels, rng(42));
  assert.equal(rounds[5].target.id, 'x'); assert.deepEqual(rounds[5].options.map(m => m.id).sort(), ['x', 'y', 'z']); assert.equal(rounds[5].theme, 'mint');
  assert.deepEqual(custom.options.map(m => m.id), ['x', 'y', 'z']);
});
test('Small collections still produce three valid choices without failing when avoiding all repeats is impossible', () => {
  for (const size of [3, 4, 5, 6]) {
    const rounds = planRooms(fixture(size), rng(size));
    assert.equal(rounds.length, 30); for (const r of rounds) { assert.equal(new Set(r.options.map(m => m.id)).size, 3); assert.ok(r.options.some(m => m.id === r.target.id)); }
  }
});
