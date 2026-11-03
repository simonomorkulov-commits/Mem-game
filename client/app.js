import { createWorld } from './scene.js';
import { initLibrary } from './library.js';
import { bindJoystick } from './joystick.js';
import { initCharacterPicker, selectedCharacter } from './character-picker.js';
import { readPreferences, savePreferences } from './preferences.js';
import { initAccountUI, startRun, answerRun, currentRun, finishRun } from './account.js';
import { initLevelEditor } from './level-editor.js';

const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const storageKey = 'igra-memov:record:v1';
let best = 0;
try { best = Math.max(0, Number(localStorage.getItem(storageKey)) || 0); } catch { /* Private browsing may disable storage. */ }
$('best-score').textContent = best;
let world, state = null, paused = false, starting = false, isNewRecord = false;
let audioContext, master, compressor, source, soundTimer;
let preferences = readPreferences();
let volume = preferences.volume, muted = preferences.muted, joystickControls;
let accountUI, levelEditor;
const buffers = new Map();

function announce(message) { $('announcer').textContent = message; }
function haptic(pattern) { if (preferences.vibration) { try { navigator.vibrate?.(pattern); } catch {} } }
function stopControls() { joystickControls?.reset(); }
function pauseForDialog() {
  stopControls();
  if (state?.status === 'playing') { paused = true; world.setActive(false); stopAudio(); }
}
function resumeIfUncovered() { if (paused && !document.querySelector('dialog[open]')) resume(); }
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
  $('round-total').textContent = state.total;
  $('score').textContent = state.score;
  $('lives').innerHTML = [0, 1, 2].map(i => `<span class="${i >= state.lives ? 'lost' : ''}">${icon('heart')}</span>`).join('');
  $('lives').setAttribute('aria-label', `Осталось жизней: ${state.lives}`);
  const dots = Math.min(state.total, 10), current = Math.floor((state.round - 1) * dots / state.total);
  $('progress').innerHTML = Array.from({ length: dots }, (_, i) => `<i class="${i < current ? 'passed' : i === current ? 'current' : ''}"></i>`).join('');
  $('progress').setAttribute('aria-label', `Комната ${state.round} из ${state.total}`);
}
async function beginRoom() {
  $('finish-actions').hidden = true;
  stopControls();
  paused = false; world.setActive(false); stopAudio();
  $('feedback-overlay').hidden = true; $('play-overlay').hidden = true;
  $('loading-overlay').hidden = false; $('loading-status').textContent = 'Открываем следующую комнату…';
  try { await Promise.all([world.setRound(state.challenge), loadAudio([state.challenge.target])]); }
  catch { showError('Не удалось загрузить картинку или звук. Обнови страницу и попробуй снова.'); return; }
  world.reset(); world.setActive(true); $('loading-overlay').hidden = true;
  $('feedback-overlay').hidden = true; $('play-overlay').hidden = false;
  updateHud(); playMeme();
  announce(`Комната ${state.round}. Слушай мем и зайди в подходящую картинку.`);
}
async function start() {
  if (!world || starting) return;
  starting = true; $('start-button').disabled = true;
  $('loading-overlay').hidden = false; $('loading-status').textContent = 'Включаем мемные звуки…';
  try {
    await ensureAudio();
    const me = await accountUI.refresh();
    if (me.signedIn && !me.profile) { $('loading-overlay').hidden = true; await accountUI.openProfile(); return; }
    state = await startRun(); isNewRecord = false; document.body.classList.add('in-game');
    $('menu-overlay').hidden = true; $('room-label').hidden = true; $('hud').hidden = false;
    $('loading-overlay').hidden = true;
    await beginRoom(); $('scene').focus({ preventScroll: true });
    $('game-frame').scrollIntoView({ block: 'center', behavior: 'instant' });
  } catch (error) { showError(error.message || 'Браузер не смог включить звук. Обнови страницу и попробуй снова.'); }
  finally { starting = false; $('start-button').disabled = false; }
}
function selectPortal(index) {
  if (!state || state.status !== 'playing' || paused || !world.active) return;
  stopControls(); haptic(10);
  world.walkToPortal(index);
  announce(`Персонаж идёт к картинке ${index + 1}.`);
}
async function enterPortal(index) {
  if (!state || state.status !== 'playing' || paused) return;
  stopControls();
  world.setActive(false); stopAudio(); state.status = 'checking';
  $('loading-overlay').hidden = false; $('loading-status').textContent = 'Проверяем ответ…';
  try { state = await answerRun(state, index); }
  catch (error) { showError(error.message); return; }
  $('loading-overlay').hidden = true;
  world.reveal(state.result.correctIndex, index); updateHud();
  $('play-overlay').hidden = true; $('feedback-overlay').hidden = false;
  const { correct, gained, meme } = state.result;
  haptic(correct ? 25 : [20, 45, 20]);
  $('feedback-icon').className = 'feedback-icon' + (correct ? '' : ' wrong');
  $('feedback-icon').innerHTML = icon(correct ? 'check' : 'x');
  $('feedback-kicker').textContent = correct ? 'МЕМНАЯ ПАМЯТЬ НЕ ПОДВЕЛА' : 'БЫВАЕТ. ЭТО ЖЕ МЕМЫ.';
  $('feedback-title').textContent = correct ? (state.streak > 1 ? `Серия ×${state.streak}!` : 'Тот самый мем!') : 'Не тот портал';
  $('feedback-text').textContent = correct ? `Это ${meme.name}. Продолжаем путешествие?` : `Звучал ${meme.name}. Правильная картинка — ${state.result.correctIndex + 1}.`;
  $('feedback-points').innerHTML = correct ? `+${gained}<small>${gained > 100 ? `100 за мем + ${gained - 100} за серию` : 'ОЧКОВ В ТВОЮ КОПИЛКУ'}</small>` : `<span style="color:var(--pink)">−1 жизнь</span><small>Осталось: ${state.lives}</small>`;
  $('next-button').querySelector('span').textContent = state.finished ? 'Посмотреть результат' : 'Следующая комната';
  playFeedback(correct); $('next-button').focus({ preventScroll: true });
  announce(`${correct ? 'Верно' : 'Ошибка'}. ${meme.name}. Очки: ${state.score}. Жизни: ${state.lives}.`);
}
function showFinish() {
  if (state.score > best) {
    best = state.score; isNewRecord = true; $('best-score').textContent = best;
    try { localStorage.setItem(storageKey, String(best)); } catch { /* Scores still work without storage. */ }
  }
  const completed = state.lives > 0 && state.round >= state.total;
  $('feedback-icon').className = 'feedback-icon'; $('feedback-icon').innerHTML = icon('cup');
  $('feedback-kicker').textContent = isNewRecord ? 'НОВЫЙ ЛИЧНЫЙ РЕКОРД' : 'ТВОЙ МЕМНЫЙ РЕЗУЛЬТАТ';
  $('feedback-title').textContent = completed ? 'Ты прошёл все комнаты!' : 'Мемы победили. Пока.';
  $('feedback-text').textContent = `Угадано ${state.correct} из ${state.round}. ${completed ? 'Мемная память в отличной форме.' : 'Ещё одна попытка — и всё получится.'}`;
  $('feedback-points').innerHTML = `${state.score}<small>ОЧКОВ · РЕКОРД ${best}</small>`;
  $('next-button').querySelector('span').textContent = 'Сыграть ещё раз';
  $('finish-actions').hidden = false;
  $('rating-result').textContent = state.ranked ? 'Результат сохранён в общем рейтинге.' : 'Войди и выбери ник, чтобы следующие результаты попали в рейтинг.';
  $('finish-profile').hidden = state.ranked;
  if (state.ranked) accountUI.refresh().catch(() => {});
  announce(`Игра закончена. ${state.score} очков. Угадано мемов: ${state.correct}.`);
}
async function next() {
  if (state?.status === 'finished') { start(); return; }
  if (state?.status !== 'result') return;
  if (state.finished) { state.status = 'finished'; showFinish(); return; }
  $('next-button').disabled = true;
  try { state = await currentRun(state); if (state.status === 'finished') showFinish(); else await beginRoom(); }
  catch (error) { showError(error.message); }
  finally { $('next-button').disabled = false; }
}
function pause() {
  if (!state || state.status !== 'playing' || paused) return;
  stopControls();
  paused = true; world.setActive(false); stopAudio(); $('pause-dialog').showModal();
  $('resume-button').focus();
}
function resume() {
  if (!state || state.status !== 'playing' || document.querySelector('dialog[open]')) return;
  paused = false; world.setActive(true); playMeme(); $('scene').focus({ preventScroll: true });
}
async function home() {
  stopControls();
  if (state?.runId && !state.finished) {
    try { await finishRun(state); } catch { /* A later sign-in can resume a run if the connection is lost. */ }
  }
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
$('touch-replay').addEventListener('click', () => { haptic(10); playMeme(); });
$('pause-button').addEventListener('click', pause);
$('resume-button').addEventListener('click', () => $('pause-dialog').close());
$('pause-dialog').addEventListener('close', resumeIfUncovered);
$('home-button').addEventListener('click', home);
$('retry-button').addEventListener('click', () => location.reload());
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (state?.status === 'playing') pause(); else if (state) home(); else window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('rules-button').addEventListener('click', () => {
  pauseForDialog();
  $('rules-dialog').showModal();
});
$('rules-dialog').addEventListener('close', resumeIfUncovered);
function applyVolume() {
  if (master) master.gain.setTargetAtTime(muted ? 0 : volume, audioContext.currentTime, .03);
  $('mute-button').innerHTML = icon(muted || volume === 0 ? 'muted' : 'sound');
  $('mute-button').setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
  $('mute-button').setAttribute('aria-pressed', String(muted));
}
$('mute-button').addEventListener('click', () => { muted = !muted; preferences.muted = muted; savePreferences(preferences); applyVolume(); if (!muted) playMeme(); else if (state?.status === 'playing') $('sound-status').textContent = 'Звук выключен'; });
document.querySelectorAll('[data-volume]').forEach(input => input.addEventListener('input', event => {
  volume = Number(event.target.value) / 100; $('volume-value').textContent = `${event.target.value}%`;
  muted = false; preferences.volume = volume; preferences.muted = false;
  savePreferences(preferences); syncSettings(); applyVolume();
}));
joystickControls = bindJoystick($('joystick'), $('joystick-thumb'), (x, z) => world?.setJoystick(x, z));
initLibrary({
  onOpen: pauseForDialog,
  onClose() { resumeIfUncovered(); accountUI?.refreshLevels().catch(() => {}); },
  onMemeAdded(meme) { levelEditor?.noteNewMeme(meme); }
});
function updateLevelCount(data) {
  $('level-total').textContent = data.total;
  const note = $('rules-dialog').querySelector('.dialog-note');
  note.textContent = `В прохождении ${data.total} уровней. У тебя 3 жизни. Таймера нет — можно подумать. Esc ставит игру на паузу.`;
}
accountUI = initAccountUI({
  onOpen: pauseForDialog, onClose: resumeIfUncovered, onLevels: updateLevelCount,
  onProfile(me) { if (me.profile) { best = me.profile.bestScore; $('best-score').textContent = best; } }
});
levelEditor = initLevelEditor({ onOpen: pauseForDialog, onClose: resumeIfUncovered, onChange: updateLevelCount });
Promise.allSettled([accountUI.refresh(), accountUI.refreshLevels()]);
const characterPicker = initCharacterPicker({
  onOpen: pauseForDialog,
  onClose: resumeIfUncovered,
  onSelect(id) { world?.setCharacter(id); }
});
function syncSettings() {
  document.body.classList.toggle('controls-right', preferences.rightJoystick);
  document.body.classList.toggle('power-saving', preferences.powerSaving);
  $('right-joystick').checked = preferences.rightJoystick;
  $('power-saving').checked = preferences.powerSaving; $('vibration').checked = preferences.vibration;
  document.querySelectorAll('[data-volume]').forEach(input => { input.value = Math.round(volume * 100); });
  $('volume-value').textContent = $('settings-volume-value').textContent = Math.round(volume * 100) + '%';
  world?.setPowerSaving(preferences.powerSaving);
}
function updatePreferences(patch) { stopControls(); preferences = { ...preferences, ...patch }; savePreferences(preferences); syncSettings(); }
for (const id of ['home-settings', 'pause-settings', 'header-settings']) $(id).addEventListener('click', () => {
  pauseForDialog(); syncSettings(); $('settings-dialog').showModal();
});
for (const id of ['settings-close', 'settings-done']) $(id).addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('close', resumeIfUncovered);
for (const [id, name] of [['right-joystick', 'rightJoystick'], ['power-saving', 'powerSaving'], ['vibration', 'vibration']]) {
  $(id).addEventListener('change', event => updatePreferences({ [name]: event.target.checked }));
}
for (const id of ['home-help', 'pause-help']) $(id).addEventListener('click', () => $('rules-button').click());
$('vibration-setting').hidden = typeof navigator.vibrate !== 'function';
$('fullscreen-button').hidden = !document.fullscreenEnabled || !document.documentElement.requestFullscreen;
$('fullscreen-button').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { /* Viewport layout remains usable if the browser declines fullscreen. */ }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen-button').textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'Открыть на весь экран'; });
syncSettings(); applyVolume();
function syncVisualViewport() { document.documentElement.style.setProperty('--visual-height', Math.round(window.visualViewport?.height || innerHeight) + 'px'); }
syncVisualViewport();
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.addEventListener('resize', syncVisualViewport);
window.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (event.code === 'Escape' && state?.status === 'playing') { event.preventDefault(); pause(); }
  if (event.repeat || paused || state?.status !== 'playing') return;
  if (event.code === 'Space') { event.preventDefault(); playMeme(); }
  if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) { event.preventDefault(); selectPortal(Number(event.code.slice(-1)) - 1); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !document.querySelector('dialog[open]')) pause(); });

try {
  world = await createWorld($('scene'), enterPortal, stopControls, selectedCharacter());
  world.setPowerSaving(preferences.powerSaving);
  $('loading-overlay').hidden = true;
  const prepare = () => { if (!state) characterPicker.preparePreviews(); };
  if (window.requestIdleCallback) requestIdleCallback(prepare, { timeout: 1800 }); else setTimeout(prepare, 500);
} catch (error) {
  console.error('Room initialization failed:', error);
  showError('Для 3D-комнаты нужен WebGL. Включи аппаратное ускорение или открой игру в современном Chrome, Edge, Firefox или Safari.');
}
