import { requestAPI } from './account.js';

const $ = id => document.getElementById(id);
const DUEL_STORAGE = 'igra-memov:duel:v1';
export function initDuels({ account, canOpen, enter, exit, unlockAudio, prepare, activate, stop, play, reveal }) {
  let room = null, active = false, pollTimer, clockTimer, offset = 0, opened = false, action = false;
  let preparedKey = '', preparingKey = '', playedKey = '', revealedKey = '', readyRequested = false, pendingAnswer = null;
  let generation = 0, networkLost = false, storedCode = '';
  const requestedCode = new URLSearchParams(location.search).get('duel')?.toUpperCase();
  try { storedCode = localStorage.getItem(DUEL_STORAGE) || ''; } catch {}
  function remember(code) { storedCode = code || ''; try { if (code) localStorage.setItem(DUEL_STORAGE, code); else localStorage.removeItem(DUEL_STORAGE); } catch {} }
  function notice(message, error = false) { $('duel-status').textContent = message; $('duel-status').classList.toggle('is-error', error); }
  const endpoint = suffix => '/api/duels/' + room.code + (suffix ? '/' + suffix : '');
  async function post(path, body = {}) { return requestAPI(path, { method: 'POST', body: JSON.stringify(body) }); }
  function stage(title, text, count = '', finished = false) {
    $('duel-stage').hidden = false; $('duel-stage-title').textContent = title; $('duel-stage-text').textContent = text;
    $('duel-stage-count').textContent = count; $('duel-result-actions').hidden = !finished;
  }
  function configureSignIn() {
    const code = $('duel-code-input').value.trim().toUpperCase() || room?.code || requestedCode;
    const returnTo = code ? '/?duel=' + encodeURIComponent(code) : '/?duels=1';
    $('duel-signin').href = '/signin-with-chatgpt?return_to=' + encodeURIComponent(returnTo);
  }
  function renderLobby() {
    if (!room) return;
    $('duel-controls').hidden = true; $('duel-lobby').hidden = false; $('duel-auth').hidden = true;
    $('duel-room-code').textContent = room.code;
    const host = room.isHost ? room.you : room.opponent, guest = room.isHost ? room.opponent : room.you;
    $('duel-host-name').textContent = host?.nickname || 'Автор комнаты'; $('duel-guest-name').textContent = guest?.nickname || 'Ждём друга';
    $('duel-host-ready').textContent = host?.ready ? 'Готов' : 'Не готов'; $('duel-guest-ready').textContent = guest?.ready ? 'Готов' : 'Не готов';
    $('duel-ready').disabled = action || !room.opponent || ['finished', 'cancelled'].includes(room.status);
    $('duel-ready').textContent = room.status === 'playing' ? 'Вернуться в дуэль' : 'Готов играть';
    if (!networkLost) notice(room.status === 'lobby' ? room.opponent ? 'Вы оба в комнате. Нажмите «Готов играть».' : 'Отправь другу код или ссылку. Затем оба нажмите «Готов играть».' : room.status === 'playing' ? 'Дуэль продолжается. Вернись в комнату.' : 'Эта дуэль закончилась. Можно создать новую.');
  }
  function setRoom(data) {
    if (room && data.code === room.code && data.serverTime < room.serverTime) return;
    const changed = room?.code !== data.code;
    room = data; offset = data.serverTime - Date.now(); networkLost = false; remember(data.code);
    if (changed) { preparedKey = preparingKey = playedKey = revealedKey = ''; pendingAnswer = null; readyRequested = false; }
    renderLobby();
    if (active) { renderGame(); autoPrepare(); }
  }
  async function refreshRanking() {
    $('duel-ranking-status').textContent = 'Загружаем результаты…';
    try {
      const data = await requestAPI('/api/duels/ranking'); const list = $('duel-ranking'); list.replaceChildren();
      $('duel-ranking-status').textContent = data.rows.length ? 'Победы в живых дуэлях. При равенстве учитываются ничьи.' : 'Пока нет завершённых дуэлей. Начни первую с другом!';
      for (const row of data.rows) {
        const li = document.createElement('li'); li.className = 'ranking-row' + (row.isYou ? ' is-you' : '');
        for (const [cls, text] of [['rank-number', row.rank], ['rank-name', row.nickname], ['rank-points', row.wins + ' 🏆']]) { const span = document.createElement('span'); span.className = cls; span.textContent = String(text); li.append(span); }
        const detail = document.createElement('small'); detail.textContent = `${row.played} дуэлей · ${row.draws} ничьих`; li.append(detail); list.append(li);
      }
    } catch (error) { $('duel-ranking-status').textContent = error.message; }
  }
  function schedulePoll(delay = document.hidden ? 5000 : 1300) {
    clearTimeout(pollTimer); if (room && (active || opened)) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (!room || !(active || opened)) return;
    const currentGeneration = generation, code = room.code;
    try {
      const data = await requestAPI('/api/duels/' + code);
      if (generation !== currentGeneration || room?.code !== code) return;
      setRoom(data);
      if (pendingAnswer && room.status === 'playing' && room.phase === 'playing' && !room.you.answered && room.round === pendingAnswer.round) {
        const body = pendingAnswer; setRoom(await post(endpoint('answer'), body)); pendingAnswer = null;
      } else if (pendingAnswer && (room.you.answered || room.round !== pendingAnswer.round || room.status !== 'playing' || room.phase !== 'playing')) pendingAnswer = null;
    } catch (error) {
      networkLost = true; notice(error.message, true);
      if (active) renderGame();
      if ([401, 403, 404].includes(error.status)) { stop(); if (active) leaveView(false); room = null; remember(''); return; }
    } finally { schedulePoll(); }
  }
  async function loadOptions() {
    const data = await requestAPI('/api/duels/options'); const select = $('duel-pack'); select.replaceChildren();
    for (const pack of data.packs) { const option = document.createElement('option'); option.value = pack.index; option.textContent = pack.title; select.append(option); }
    $('duel-create').disabled = !data.packs.length;
  }
  async function showAccess() {
    const me = await account.refresh();
    const allowed = me.signedIn && !!me.profile;
    $('duel-auth').hidden = allowed; $('duel-controls').hidden = !allowed; $('duel-lobby').hidden = true;
    $('duel-signin').hidden = me.signedIn; $('duel-profile').hidden = !me.signedIn; configureSignIn();
    return allowed;
  }
  async function open() {
    if (!canOpen() || active) return;
    opened = true; $('duel-dialog').showModal(); notice('Открываем живые дуэли…');
    refreshRanking();
    try {
      if (!await showAccess()) { notice('Войди и выбери ник, чтобы играть с другом.'); return; }
      await loadOptions();
      const current = await requestAPI('/api/duels/current');
      if (current.room && ['lobby', 'playing'].includes(current.room.status)) { setRoom(current.room); schedulePoll(100); }
      else {
        room = null; notice('Создай комнату или введи код друга.');
        if (requestedCode) { $('duel-code-input').value = requestedCode; notice('Код друга уже введён. Нажми «Войти».'); }
        else if (storedCode) {
          try { const previous = await requestAPI('/api/duels/' + storedCode); if (previous.status === 'finished') { setRoom(previous); notice('Предыдущая дуэль закончилась. Создай новую или введи код друга.'); $('duel-lobby').hidden = true; $('duel-controls').hidden = false; } } catch {}
        }
      }
    } catch (error) { notice(error.message, true); }
  }
  async function withAction(callback) {
    if (action) return; action = true;
    for (const id of ['duel-create', 'duel-join', 'duel-ready', 'duel-rematch']) $(id).disabled = true;
    try { await callback(); }
    catch (error) { notice(error.message, true); if (active) stage('Не получилось подключиться', error.message); }
    finally {
      action = false; for (const id of ['duel-create', 'duel-join', 'duel-rematch']) $(id).disabled = false;
      if (room) renderLobby();
    }
  }
  async function ready() {
    await withAction(async () => {
      if (!room?.opponent) return;
      const code = room.code; readyRequested = true;
      await unlockAudio(); active = true; opened = false; enter(); $('duel-dialog').close();
      $('duel-hud').hidden = false; stage('Готовим комнату', 'Загружаем картинки и звук для общего старта.');
      if (room.challenge) {
        const key = code + ':' + room.round; await prepare(room.challenge); preparedKey = key;
      }
      if (room.code !== code) return;
      if (room.phase === 'preparing' && ['lobby', 'playing'].includes(room.status)) setRoom(await post(endpoint('ready'), { round: room.round }));
      else setRoom(await requestAPI(endpoint()));
      clockTimer ||= setInterval(renderGame, 100); renderGame(); schedulePoll(50);
    });
  }
  async function autoPrepare() {
    if (!active || !readyRequested || room?.status !== 'playing' || room.phase !== 'preparing') return;
    const key = room.code + ':' + room.round; if (preparingKey === key || room.you.ready) return;
    preparingKey = key; stop();
    try {
      if (preparedKey !== key) { await prepare(room.challenge); preparedKey = key; }
      if (active && room.code + ':' + room.round === key && room.phase === 'preparing') setRoom(await post(endpoint('ready'), { round: room.round }));
    } catch (error) { notice(error.message, true); networkLost = true; stage('Не удалось загрузить комнату', error.message); }
    finally { if (preparingKey === key) preparingKey = ''; }
  }
  function isPlayable() {
    const now = Date.now() + offset;
    return !!(active && room?.status === 'playing' && room.phase === 'playing' && !room.you.answered && !pendingAnswer && !networkLost &&
      now >= room.startsAt && now < room.endsAt && preparedKey === room.code + ':' + room.round && !document.hidden && !document.querySelector('dialog[open]'));
  }
  function renderGame() {
    if (!active || !room) return;
    $('duel-you-name').textContent = room.you.nickname; $('duel-you-score').textContent = room.you.score;
    $('duel-opponent-name').textContent = room.opponent?.nickname || 'Соперник'; $('duel-opponent-score').textContent = room.opponent?.score || 0;
    $('duel-round').textContent = `${room.round} / ${room.total}`;
    const now = Date.now() + offset, key = room.code + ':' + room.round;
    activate(isPlayable());
    if (networkLost) { $('duel-clock').textContent = 'Нет связи'; stage('Восстанавливаем связь', 'Проверяем состояние дуэли. Не закрывай игру.'); return; }
    if (['finished', 'cancelled'].includes(room.status)) {
      stop(); $('duel-clock').textContent = 'Итог';
      const title = room.status === 'cancelled' ? 'Дуэль отменена' : ({ win: 'Победа!', loss: 'Победил соперник', draw: 'Ничья!' })[room.outcome];
      const explanation = ({ left: 'Один из игроков вышел из дуэли.', disconnected: 'Игрок не вернулся в течение 90 секунд.', 'not-ready': 'Один из игроков не загрузил следующую комнату.', expired: 'Время комнаты истекло.', 'both-away': 'Оба игрока потеряли соединение.' })[room.reason] || 'Все комнаты пройдены. Ещё один матч?';
      stage(title, explanation, room.status === 'finished' ? `${room.you.score} : ${room.opponent?.score || 0}` : '', true);
      $('duel-rematch').hidden = room.status !== 'finished'; $('duel-rematch').textContent = room.rematchCode ? 'Соперник зовёт на реванш' : 'Реванш · следующая подборка';
      $('duel-record-note').textContent = room.status === 'finished' ? 'Результат учтён в рейтинге дуэлей.' : 'Отменённая дуэль не влияет на рейтинг.';
      return;
    }
    if (room.status === 'lobby' || room.phase === 'preparing') {
      $('duel-clock').textContent = 'Подготовка';
      stage('Готовимся к старту', room.you.ready ? 'Ты готов. Ждём загрузки у соперника…' : 'Загружаем картинки и звук…'); return;
    }
    if (room.phase === 'reveal') {
      $('duel-clock').textContent = 'Ответы';
      if (revealedKey !== key && room.result) { revealedKey = key; reveal(room.result); }
      stage(room.result?.timedOut ? 'Время вышло' : room.result?.correct ? 'Верно! +100' : 'Не тот портал', `Это ${room.result?.meme.name || 'мем'}. Следующая комната через ${Math.max(1, Math.ceil((room.nextAt - now) / 1000))}…`);
      return;
    }
    if (now < room.startsAt) {
      $('duel-clock').textContent = 'Общий старт'; stage('Слушай и выбирай', 'Звук включится после отсчёта.', Math.max(1, Math.ceil((room.startsAt - now) / 1000))); return;
    }
    $('duel-clock').textContent = Math.max(0, Math.ceil((room.endsAt - now) / 1000)) + ' сек';
    if (room.you.answered || pendingAnswer) { stage('Ответ принят', room.opponent?.answered ? 'Сверяем ответы…' : 'Соперник ещё выбирает. Правильный мем откроется вам обоим.'); return; }
    if (now >= room.endsAt) { stage('Время вышло', 'Получаем результаты комнаты…'); return; }
    $('duel-stage').hidden = false;
    if (preparedKey !== key) { stage('Загружаем комнату', 'Дуэль продолжается. Подключаемся…'); return; }
    $('duel-stage').hidden = true;
    if (playedKey !== key && isPlayable()) { playedKey = key; play(); }
  }
  async function answer(index) {
    if (!isPlayable()) return;
    stop(); pendingAnswer = { round: room.round, optionId: room.challenge.options[index].id, requestId: crypto.randomUUID() }; renderGame();
    try { const data = await post(endpoint('answer'), pendingAnswer); pendingAnswer = null; setRoom(data); }
    catch (error) {
      if (error.status === 409) { pendingAnswer = null; await poll(); }
      else { networkLost = true; notice(error.message, true); renderGame(); }
    }
    schedulePoll(50);
  }
  function leaveView(clear = true) {
    active = false; readyRequested = false; pendingAnswer = null; generation++;
    clearTimeout(pollTimer); clearInterval(clockTimer); clockTimer = null; stop();
    $('duel-hud').hidden = $('duel-stage').hidden = true; exit();
    if (clear) { room = null; remember(''); }
  }
  function askLeave() { if (!active) return; stop(); $('duel-leave-dialog').showModal(); }
  $('duel-button').addEventListener('click', open);
  $('duel-close').addEventListener('click', () => $('duel-dialog').close());
  $('duel-dialog').addEventListener('close', () => { opened = false; if (!active) { clearTimeout(pollTimer); generation++; } });
  $('duel-create-form').addEventListener('submit', event => { event.preventDefault(); withAction(async () => { setRoom(await post('/api/duels', { pack: Number($('duel-pack').value) })); schedulePoll(50); }); });
  $('duel-join-form').addEventListener('submit', event => { event.preventDefault(); withAction(async () => {
    const code = $('duel-code-input').value.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw Error('Введи код из шести букв и цифр.');
    setRoom(await post('/api/duels/' + code + '/join')); $('duel-code-input').blur(); schedulePoll(50);
  }); });
  $('duel-ready').addEventListener('click', ready);
  $('duel-profile').addEventListener('click', () => account.openProfile());
  $('profile-dialog').addEventListener('close', () => { if (opened && !room) showAccess().then(allowed => { if (allowed) loadOptions(); }).catch(error => notice(error.message, true)); });
  $('duel-code-input').addEventListener('input', configureSignIn);
  $('duel-copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText(room.code); notice('Код скопирован: ' + room.code); } catch { notice('Передай другу код: ' + room.code); } });
  $('duel-share').addEventListener('click', async () => {
    const url = new URL(location.origin + '/'); url.searchParams.set('duel', room.code);
    try { if (navigator.share) await navigator.share({ title: 'Игра мемов — дуэль', text: 'Заходи на мемную дуэль! Код: ' + room.code, url: url.href });
      else { await navigator.clipboard.writeText(url.href); notice('Ссылка скопирована. Отправь её другу!'); } }
    catch (error) { if (error.name !== 'AbortError') notice('Ссылка на дуэль: ' + url.href); }
  });
  $('duel-lobby-leave').addEventListener('click', () => { if (room?.status === 'playing') { ready().then(askLeave); return; }
    withAction(async () => { await post(endpoint('leave')); room = null; remember(''); generation++; clearTimeout(pollTimer); await showAccess(); notice('Ты вышел из комнаты. Можно создать новую дуэль.'); });
  });
  $('duel-exit').addEventListener('click', askLeave);
  $('duel-leave-cancel').addEventListener('click', () => { $('duel-leave-dialog').close(); renderGame(); });
  $('duel-leave-confirm').addEventListener('click', () => withAction(async () => { await post(endpoint('leave')); $('duel-leave-dialog').close(); leaveView(); }));
  $('duel-leave-dialog').addEventListener('close', renderGame);
  $('duel-finish-home').addEventListener('click', () => leaveView());
  $('duel-rematch').addEventListener('click', () => withAction(async () => {
    const data = await post(endpoint('rematch')); leaveView(false); room = null; setRoom(data); await open();
  }));
  $('duel-ranking-refresh').addEventListener('click', refreshRanking);
  document.addEventListener('visibilitychange', () => { if (active && document.hidden) stop(); if (!document.hidden && (active || opened)) schedulePoll(0); });
  if (requestedCode || new URLSearchParams(location.search).has('duels')) { if (requestedCode) $('duel-code-input').value = requestedCode; open(); }
  return { answer, askLeave, suspend: stop, refresh: renderGame, get active() { return active; }, get canPlay() { return isPlayable(); }, get challenge() { return room?.challenge; } };
}
