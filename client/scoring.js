export const INITIAL_LIVES = 3;
export const DEFAULT_LEVEL_COUNT = 30;
export const ROOM_THEMES = {
  neon: { name: 'Неон', wall: '#33304e', floor: '#35334e', light: '#9a71ff' },
  ocean: { name: 'Океан', wall: '#203f50', floor: '#234154', light: '#55cce7' },
  sunset: { name: 'Закат', wall: '#543447', floor: '#453345', light: '#ed9e72' },
  mint: { name: 'Мята', wall: '#244c43', floor: '#2c4542', light: '#75e2b4' },
  space: { name: 'Космос', wall: '#29284b', floor: '#292d46', light: '#8fafff' },
  rose: { name: 'Розовый', wall: '#54304c', floor: '#493346', light: '#ef8ec9' }
};
export function scoreAnswer(state, correct) {
  const streak = correct ? state.streak + 1 : 0;
  const gained = correct ? 100 + Math.min(streak - 1, 4) * 25 : 0;
  return { score: state.score + gained, streak, correct: state.correct + Number(correct),
    lives: state.lives - Number(!correct), gained };
}
