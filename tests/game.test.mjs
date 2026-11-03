import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, makeRound, answer, nextRound, move, portalAt } from '../client/game.js';

test('Every room has three unique options, includes the answer, and never repeats the previous sound', () => {
  let previous;
  for (let i = 0; i < 300; i++) {
    const round = makeRound(previous);
    assert.equal(new Set(round.options.map(m => m.id)).size, 3);
    assert.equal(round.options[round.correctIndex].id, round.target.id);
    assert.notEqual(round.target.id, previous);
    previous = round.target.id;
  }
});

test('A perfect nine-room run finishes with streak bonuses and only scores once per room', () => {
  let state = newGame();
  for (let i = 0; i < 9; i++) {
    state = answer(state, state.challenge.correctIndex);
    assert.equal(answer(state, 0), state);
    state = nextRound(state);
  }
  assert.equal(state.status, 'finished');
  assert.equal(state.score, 1550);
  assert.equal(state.correct, 9);
  assert.equal(state.lives, 3);
});

test('Three wrong doors end the game without awarding points', () => {
  let state = newGame();
  for (let i = 0; i < 3; i++) state = nextRound(answer(state, (state.challenge.correctIndex + 1) % 3));
  assert.equal(state.status, 'finished');
  assert.equal(state.lives, 0);
  assert.equal(state.score, 0);
});

test('Wrong answer resets the combo; invalid actions do not mutate state', () => {
  let state = newGame();
  assert.equal(nextRound(state), state);
  assert.equal(answer(state, -1), state);
  state = nextRound(answer(state, state.challenge.correctIndex));
  state = nextRound(answer(state, (state.challenge.correctIndex + 1) % 3));
  state = answer(state, state.challenge.correctIndex);
  assert.equal(state.result.gained, 100);
  assert.equal(state.streak, 1);
});

test('Character movement is bounded, frame-safe, and equally fast on diagonals', () => {
  const straight = move({ x: 0, z: 0 }, { x: 1, z: 0 }, .02);
  const diagonal = move({ x: 0, z: 0 }, { x: 1, z: 1 }, .02);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - straight.x) < 1e-10);
  assert.equal(move({ x: 6.2, z: 6 }, { x: 1, z: 1 }, 10).x, 6.25);
  assert.deepEqual(move({ x: 0, z: 0 }, { x: 0, z: 0 }, .02), { x: 0, z: 0 });
});

test('Only walking into an actual picture triggers its portal', () => {
  assert.equal(portalAt(-4, -4.5), 0);
  assert.equal(portalAt(0, -4.5), 1);
  assert.equal(portalAt(4, -4.5), 2);
  assert.equal(portalAt(0, 3), -1);
  assert.equal(portalAt(2, -4.5), -1);
});
