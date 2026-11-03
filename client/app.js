import { createWorld } from './scene.js';
import { MEMES } from './data.js';
import { newGame, answer, nextRound } from './game.js';
import { initLibrary, getCatalog } from './library.js';
import { bindJoystick } from './joystick.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const storageKey = 'igra-memov:record:v1';
let best = 0;
try { best = Math.max(0, Number(localStorage.getItem(storageKey)) || 0); } catch { /* Private browsing may disable storage. */ }
$('best-score').textContent = best;
let world, state = null, paused = false, starting = false, isNewRecord = false;
let audioContext, master, compressor, source, soundTimer;
let volume = .65, muted = false;
let activeMemes = MEMES;
const buffers = new Map();

function announce(message) { $('announcer').textContent = message; }
function stopAudio() {
  if (source) { try { source.stop(); } catch { /* Already ended. */ } source = null; }
  clearTimeout(soundTimer); $('wave').classList.remove('playing');
}
function ensureAudio() {
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (!master) {
    master = audioContext.createGain(); master.gain.value = muted ? 0 : volume;
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.knee.value = 20; compressor.ratio.value = 5;
    master.connect(compressor); compressor.connect(audioContext.destination);
  }
  return audioContext.resume();
}
async function loadAudio(memes) {
  await Promise.all(memes.filter(m => !buffers.has(m.id)).map(async meme => {
    const response = await fetch(meme.audio);
    if (!response.ok) throw Error('Не удалось загрузить звук. Проверь соединение и попробуй снова.');
    const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    if (!buffer.duration) throw Error('Один из звуков не воспроизводится. Обнови страницу.');
    buffers.set(meme.id, buffer);
    $('loading-status').textContent = 'Готовим звук мема…';
  }));
  for (const id of buffers.keys()) {
    if (buffers.size <= 10) break;
    if (!memes.some(m => m.id === id)) buffers.delete(id);
  }
}
function playMeme() {
  if (!state || state.status !== 'playing' || paused || !audioContext) return;
  stopAudio();
  if (muted || volume === 0) { $('sound-status').textContent = 'Включи звук, чтобы услышать мем'; return; }
  const buffer = buffers.get(state.challenge.target.id);
  if (!buffer) return;
  audioContext.resume().catch(() => { $('sound-status').textContent = 'Нажми «Ещё раз», чтобы включить звук'; });
  source = audioContext.createBufferSource(); source.buffer = buffer;
  source.connect(master); source.start();
  $('wave').classList.add('playing'); $('sound-status').textContent = 'Слушай. Узнавай. Заходи.';
  soundTimer = setTimeout(() => $('wave').classList.remove('playing'), buffer.duration * 1000);
}
function playFeedback(correct) {
  if (!audioContext || muted) return;
  const now = audioContext.currentTime;
  for (const [offset, frequency] of (correct ? [[0, 523], [.1, 659], [.2, 784]] : [[0, 200], [.16, 150]])) {
    const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.type = 'sine'; osc.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(.13, now + offset + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .22);
    osc.connect(gain); gain.connect(master); osc.start(now + offset); osc.stop(now + offset + .25);
  }
}
function updateHud() {
  $('round-number').textContent = String(state.round).padStart(2, '0');
  $('score').textContent = state.score;
  $('lives').innerHTML = [0, 1, 2].map(i => `<span class="${i >= state.lives ? 'lost' : ''}">${icon('heart')}</span>`).join('');
  $('lives').setAttribute('aria-label', `Осталось жизней: ${state.lives}`);
  $('progress').innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${i < state.round - 1 ? 'passed' : i === state.round - 1 ? 'current' : ''}"></i>`).join('');
  $('progress').setAttribute('aria-label', `Комната ${state.round} из 9`);
}
async function beginRoom() {
  paused = false; world.setActive(false); stopAudio();
  $('feedback-overlay').hidden = true; $('play-overlay').hidden = true;
  $('loading-overlay').hidden = false; $('loading-status').textContent = 'Открываем следующую комнату…';
  try { await Promise.all([world.setRound(state.challenge), loadAudio([state.challenge.target])]); }
  catch { showError('Не удалось загрузить картинку или звук. Обнови страницу и попробуй снова.'); return; }
  world.reset(); world.setActive(true); $('loading-overlay').hidden = true;
  $('feedback-overlay').hidden = true; $('play-overlay').hidden = false;
  document.querySelectorAll('[data-portal]').forEach((button, i) => {
    button.classList.remove('selected');
    button.setAttribute('aria-label', `Пройти в картинку ${i + 1}: ${state.challenge.options[i].name}`);
  });
  updateHud(); playMeme();
  announce(`Комната ${state.round}. Слушай мем и зайди в подходящую картинку.`);
}
async function start() {
  if (!world || starting) return;
  starting = true; $('start-button').disabled = true;
  $('loading-overlay').hidden = false; $('loading-status').textContent = 'Включаем мемные звуки…';
  try {
    await ensureAudio();
    activeMemes = (await getCatalog()).memes;
    state = newGame(Math.random, activeMemes); isNewRecord = false; document.body.classList.add('in-game');
    $('menu-overlay').hidden = true; $('room-label').hidden = true; $('hud').hidden = false;
    $('loading-overlay').hidden = true;
    await beginRoom(); $('scene').focus({ preventScroll: true });
    $('game-frame').scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (error) { showError(error.message || 'Браузер не смог включить звук. Обнови страницу и попробуй снова.'); }
  finally { starting = false; $('start-button').disabled = false; }
}
function selectPortal(index) {
  if (!state || state.status !== 'playing' || paused || !world.active) return;
  world.walkToPortal(index);
  document.querySelectorAll('[data-portal]').forEach((button, i) => button.classList.toggle('selected', i === index));
}
function enterPortal(index) {
  if (!state || state.status !== 'playing' || paused) return;
  state = answer(state, index); world.setActive(false); stopAudio();
  world.reveal(state.challenge.correctIndex, index); updateHud();
  $('play-overlay').hidden = true; $('feedback-overlay').hidden = false;
  const { correct, gained, meme } = state.result;
  $('feedback-icon').className = 'feedback-icon' + (correct ? '' : ' wrong');
  $('feedback-icon').innerHTML = icon(correct ? 'check' : 'x');
  $('feedback-kicker').textContent = correct ? 'МЕМНАЯ ПАМЯТЬ НЕ ПОДВЕЛА' : 'БЫВАЕТ. ЭТО ЖЕ МЕМЫ.';
  $('feedback-title').textContent = correct ? (state.streak > 1 ? `Серия ×${state.streak}!` : 'Тот самый мем!') : 'Не тот портал';
  $('feedback-text').textContent = correct ? `Это ${meme.name}. Продолжаем путешествие?` : `Звучал ${meme.name}. Правильная картинка — ${state.challenge.correctIndex + 1}.`;
  $('feedback-points').innerHTML = correct ? `+${gained}<small>${gained > 100 ? `100 за мем + ${gained - 100} за серию` : 'ОЧКОВ В ТВОЮ КОПИЛКУ'}</small>` : `<span style="color:var(--pink)">−1 жизнь</span><small>Осталось: ${state.lives}</small>`;
  $('next-button').querySelector('span').textContent = state.lives <= 0 || state.round >= 9 ? 'Посмотреть результат' : 'Следующая комната';
  playFeedback(correct); $('next-button').focus({ preventScroll: true });
  announce(`${correct ? 'Верно' : 'Ошибка'}. ${meme.name}. Очки: ${state.score}. Жизни: ${state.lives}.`);
}
function showFinish() {
  if (state.score > best) {
    best = state.score; isNewRecord = true; $('best-score').textContent = best;
    try { localStorage.setItem(storageKey, String(best)); } catch { /* Scores still work without storage. */ }
  }
  const completed = state.lives > 0;
  $('feedback-icon').className = 'feedback-icon'; $('feedback-icon').innerHTML = icon('cup');
  $('feedback-kicker').textContent = isNewRecord ? 'НОВЫЙ ЛИЧНЫЙ РЕКОРД' : 'ТВОЙ МЕМНЫЙ РЕЗУЛЬТАТ';
  $('feedback-title').textContent = completed ? 'Ты прошёл все комнаты!' : 'Мемы победили. Пока.';
  $('feedback-text').textContent = `Угадано ${state.correct} из ${state.round}. ${completed ? 'Мемная память в отличной форме.' : 'Ещё одна попытка — и всё получится.'}`;
  $('feedback-points').innerHTML = `${state.score}<small>ОЧКОВ · РЕКОРД ${best}</small>`;
  $('next-button').querySelector('span').textContent = 'Сыграть ещё раз';
  announce(`Игра закончена. ${state.score} очков. Угадано мемов: ${state.correct}.`);
}
function next() {
  if (state?.status === 'finished') { start(); return; }
  if (state?.status !== 'result') return;
  state = nextRound(state);
  if (state.status === 'finished') showFinish(); else beginRoom();
}
function pause() {
  if (!state || state.status !== 'playing' || paused) return;
  paused = true; world.setActive(false); stopAudio(); $('pause-dialog').showModal();
  $('resume-button').focus();
}
function resume() {
  if (!state || state.status !== 'playing') return;
  paused = false; world.setActive(true); playMeme(); $('scene').focus({ preventScroll: true });
}
function home() {
  state = null; paused = false; stopAudio(); world.setActive(false); world.reset();
  document.body.classList.remove('in-game'); $('pause-dialog').close();
  $('hud').hidden = true; $('play-overlay').hidden = true; $('feedback-overlay').hidden = true;
  $('menu-overlay').hidden = false; $('room-label').hidden = false;
  $('start-button').focus({ preventScroll: true });
}
function showError(message) {
  $('loading-overlay').hidden = true; $('error-message').textContent = message; $('error-overlay').hidden = false;
  world?.setActive(false); stopAudio();
}
$('start-button').addEventListener('click', start);
$('next-button').addEventListener('click', next);
$('replay-button').addEventListener('click', playMeme);
$('touch-replay').addEventListener('click', playMeme);
$('pause-button').addEventListener('click', pause);
$('resume-button').addEventListener('click', () => $('pause-dialog').close());
$('pause-dialog').addEventListener('close', () => { if (paused) resume(); });
$('home-button').addEventListener('click', home);
$('retry-button').addEventListener('click', () => location.reload());
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (state?.status === 'playing') pause(); else if (state) home(); else window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('rules-button').addEventListener('click', () => {
  if (state?.status === 'playing') { paused = true; world.setActive(false); stopAudio(); }
  $('rules-dialog').showModal();
});
$('rules-dialog').addEventListener('close', () => { if (paused && !$('pause-dialog').open) resume(); });
function applyVolume() {
  if (master) master.gain.setTargetAtTime(muted ? 0 : volume, audioContext.currentTime, .03);
  $('mute-button').innerHTML = icon(muted || volume === 0 ? 'muted' : 'sound');
  $('mute-button').setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
  $('mute-button').setAttribute('aria-pressed', String(muted));
}
$('mute-button').addEventListener('click', () => { muted = !muted; applyVolume(); if (!muted) playMeme(); else if (state?.status === 'playing') $('sound-status').textContent = 'Звук выключен'; });
$('volume').addEventListener('input', event => {
  volume = Number(event.target.value) / 100; $('volume-value').textContent = `${event.target.value}%`;
  muted = false; applyVolume();
});
document.querySelectorAll('[data-portal]').forEach(button => button.addEventListener('click', () => selectPortal(Number(button.dataset.portal))));
bindJoystick($('joystick'), $('joystick-thumb'), (x, z) => world?.setJoystick(x, z));
initLibrary({
  onOpen() { if (state?.status === 'playing') { paused = true; world.setActive(false); stopAudio(); } },
  onClose() { if (paused && !$('pause-dialog').open) resume(); }
});
window.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (event.code === 'Escape' && state?.status === 'playing') { event.preventDefault(); pause(); }
  if (event.repeat || paused || state?.status !== 'playing') return;
  if (event.code === 'Space') { event.preventDefault(); playMeme(); }
  if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) { event.preventDefault(); selectPortal(Number(event.code.slice(-1)) - 1); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !document.querySelector('dialog[open]')) pause(); });

try {
  world = await createWorld($('scene'), enterPortal, () => { document.querySelectorAll('[data-portal]').forEach(b => b.classList.remove('selected')); });
  $('loading-overlay').hidden = true;
} catch (error) {
  console.error('Room initialization failed:', error);
  showError('Для 3D-комнаты нужен WebGL. Включи аппаратное ускорение или открой игру в современном Chrome, Edge, Firefox или Safari.');
}
