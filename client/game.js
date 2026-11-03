import { MEMES, TOTAL_ROUNDS, PORTAL_X } from './data.js';
import { scoreAnswer } from './scoring.js';

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function makeRound(previousId, random = Math.random, memes = MEMES) {
  if (memes.length < 3 || new Set(memes.map(m => m.id)).size !== memes.length) throw Error('Для комнаты нужны минимум три разных мема.');
  const target = shuffle(memes.filter(m => m.id !== previousId), random)[0];
  const others = shuffle(memes.filter(m => m.id !== target.id), random).slice(0, 2);
  const options = shuffle([target, ...others], random);
  return { target, options, correctIndex: options.findIndex(m => m.id === target.id) };
}

export function newGame(random = Math.random, memes = MEMES) {
  return { status: 'playing', round: 1, score: 0, lives: 3, streak: 0,
    correct: 0, total: TOTAL_ROUNDS, memes: [...memes], challenge: makeRound(null, random, memes), result: null };
}

export function answer(state, index) {
  if (state.status !== 'playing' || !Number.isInteger(index) || index < 0 || index > 2) return state;
  const correct = index === state.challenge.correctIndex;
  const points = scoreAnswer(state, correct);
  return { ...state, ...points, status: 'result',
    result: { correct, selected: index, gained: points.gained, meme: state.challenge.target } };
}

export function nextRound(state, random = Math.random) {
  if (state.status !== 'result') return state;
  if (state.lives <= 0 || state.round >= state.total) return { ...state, status: 'finished' };
  return { ...state, status: 'playing', round: state.round + 1,
    challenge: makeRound(state.challenge.target.id, random, state.memes), result: null };
}

export function portalAt(x, z) {
  if (z > -4.35) return -1;
  return PORTAL_X.findIndex(px => Math.abs(px - x) < 1.16);
}

export function move(position, direction, seconds, speed = 1) {
  const length = Math.hypot(direction.x, direction.z);
  if (!length || seconds <= 0) return { ...position };
  const distance = 4.7 * Math.min(seconds, 0.05) * Math.max(0, Math.min(1, speed));
  return { x: Math.max(-6.25, Math.min(6.25, position.x + direction.x / length * distance)),
    z: Math.max(-5.2, Math.min(6, position.z + direction.z / length * distance)) };
}
