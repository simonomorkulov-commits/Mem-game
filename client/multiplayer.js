import { requestAPI } from './account.js';

const $ = id => document.getElementById(id);
export function initMultiplayer({ account, canOpen, enter, exit, unlockAudio, prepare, activate, stop, play, reveal }) {
  let room = null, active = false, opened = false, allowed = false, busy = false, mode = 'find';
  let pollTimer, listTimer, clockTimer, generation = 0, offset = 0, lost = false, localReady = false;
  let prepared = '', preparing = '', played = '', revealed = '', pending = null, selectedRoom = null;
  const query = new URLSearchParams(location.search);
  let invitation = /^[a-f0-9-]{36}$/.test(query.get('room') || '') ? query.get('room') : null;
  const key = () => room ? room.id + ':' + room.round : '';
  const path = action => '/api/matches/' + room.id + (action ? '/' + action : '');
  const post = (url, body = {}) => requestAPI(url, { method: 'POST', body: JSON.stringify(body) });
  function notice(text, error = false) { $('online-status').textContent = text; $('online-status').classList.toggle('is-error', error); }
  function pane(next) {
    mode = next;
    for (const name of ['find', 'create', 'lobby']) $('online-' + name).hidden = name !== next || (name !== 'find' && !allowed);
    $('online-auth').hidden = allowed;
    $('online-heading').textContent = ({ find: 'Найти игры', create: 'Создать комнату', lobby: 'Комната игроков' })[next];
    if (next !== 'find') clearTimeout(listTimer);
  }
  function signInLink() {
    const returnTo = invitation ? '/?room=' + encodeURIComponent(invitation) : '/?online=' + (mode === 'create' ? 'create' : 'find');
    $('online-signin').href = '/signin-with-chatgpt?return_to=' + encodeURIComponent(returnTo);
  }
  async function access() {
    const me = await account.refresh(); allowed = me.signedIn && !!me.profile;
    $('online-signin').hidden = me.signedIn; $('online-profile').hidden = !me.signedIn;
    pane(mode); signInLink(); return allowed;
  }
  function lobby() {
    if (!room) return;
    pane('lobby'); $('online-room-title').textContent = room.title;
    $('online-room-kind').textContent = room.locked ? '🔒 С паролем' : 'Открытая';
    $('online-lobby-count').textContent = `${room.count} / 4 игрока · ${room.total} уровней`;
    const list = $('online-members'); list.replaceChildren();
    for (let slot = 0; slot < 4; slot++) {
      const player = room.players.find(p => p.slot === slot), card = document.createElement('div'); card.className = 'online-member' + (player?.isYou ? ' is-you' : '') + (!player ? ' empty' : '');
      for (const [tag, text] of [['b', player?.nickname || 'Свободное место'], ['span', player ? player.isHost ? 'Создатель комнаты' : player.isYou ? 'Это ты' : 'Игрок' : 'До 4 участников'], ['small', player ? !player.active ? 'Вышел' : player.ready ? 'Готов' : 'Не готов' : 'Ждём игрока']]) {
        const element = document.createElement(tag); element.textContent = text; card.append(element);
      }
      list.append(card);
    }
    $('online-ready').disabled = busy || !['lobby', 'playing'].includes(room.status) || !room.you.active;
    $('online-ready').textContent = room.status === 'playing' ? 'Вернуться в матч' : room.you.ready ? 'Отменить готовность' : 'Готов';
    $('online-start').hidden = !room.isHost || room.status !== 'lobby'; $('online-start').disabled = busy || !room.canStart;
    if (!lost) notice(room.status === 'lobby' ? room.canStart ? room.isHost ? 'Все готовы. Начни матч или дождись ещё игроков.' : 'Все готовы. Создатель скоро начнёт матч.' : 'Нажмите «Готов». Создатель может начать, когда готовы 2–4 игрока.' : 'Матч продолжается. Вернись в игровую комнату.');
  }
  function scores() {
    if (!room) return;
    const list = $('online-scores'); list.replaceChildren(); list.style.gridTemplateColumns = `repeat(${room.players.length}, 1fr)`;
    for (const player of room.players) {
      const item = document.createElement('div'); item.className = 'group-score' + (player.isYou ? ' is-you' : '') + (!player.active ? ' left' : '');
      const name = document.createElement('span'), value = document.createElement('b'); name.textContent = player.nickname; name.title = player.nickname;
      value.textContent = player.score; item.append(name, value); list.append(item);
    }
  }
  function setRoom(data) {
    if (room?.id === data.id && data.serverTime < room.serverTime) return;
    const changed = room?.id !== data.id; room = data; offset = data.serverTime - Date.now(); lost = false;
    if (changed) { prepared = preparing = played = revealed = ''; pending = null; localReady = false; }
    lobby(); scores();
    if (!active && room.status === 'playing' && localReady && prepared === key()) enterView();
    if (active) { render(); autoPrepare(); }
    else if (room.status === 'cancelled') { room = null; pane('find'); notice('Комната закрыта. Выбери другую игру.'); refreshRooms(); }
  }
  async function action(callback, onError) {
    if (busy) return; busy = true;
    for (const id of ['online-create-submit', 'online-ready', 'online-start', 'online-join-submit', 'duel-rematch']) $(id).disabled = true;
    try { await callback(); }
    catch (error) { if (onError) onError(error); else { notice(error.message, true); if (active) stage('Не удалось выполнить действие', error.message); } }
    finally { busy = false; for (const id of ['online-create-submit', 'online-join-submit', 'duel-rematch']) $(id).disabled = false; if (room) lobby(); }
  }
  async function packs() {
    const data = await requestAPI('/api/duels/options'), select = $('online-pack'); select.replaceChildren();
    for (const pack of data.packs) { const option = document.createElement('option'); option.value = pack.index; option.textContent = pack.title; select.append(option); }
    $('online-create-submit').disabled = !data.packs.length;
  }
  async function ranking() {
    try {
      const data = await requestAPI('/api/duels/ranking'), list = $('online-ranking'); list.replaceChildren();
      $('online-ranking-status').textContent = data.rows.length ? 'Победы в онлайн-матчах. Результаты сохраняются в профиле.' : 'Пока нет завершённых матчей.';
      for (const row of data.rows) {
        const item = document.createElement('li'); item.className = 'ranking-row' + (row.isYou ? ' is-you' : '');
        for (const [cls, text] of [['rank-number', row.rank], ['rank-name', row.nickname], ['rank-points', row.wins + ' 🏆']]) { const span = document.createElement('span'); span.className = cls; span.textContent = String(text); item.append(span); }
        const detail = document.createElement('small'); detail.textContent = `${row.played} матчей · ${row.draws} ничьих`; item.append(detail); list.append(item);
      }
    } catch (error) { $('online-ranking-status').textContent = error.message; }
  }
  async function refreshRooms() {
    clearTimeout(listTimer); if (!opened || active || mode !== 'find') return;
    try {
      const data = await requestAPI('/api/matches/rooms'); if (!opened || mode !== 'find') return;
      const list = $('online-rooms'); list.replaceChildren();
      $('online-list-status').textContent = data.rooms.length ? 'Выбирай соперников. В комнаты с замком нужен пароль.' : 'Свободных комнат пока нет. Создай свою, чтобы другие игроки присоединились.';
      for (const item of data.rooms) {
        const card = document.createElement('article'); card.className = 'online-room'; card.dataset.room = item.id;
        const text = document.createElement('div'), title = document.createElement('b'), detail = document.createElement('small');
        title.textContent = (item.locked ? '🔒 ' : '') + item.title; detail.textContent = `${item.host} · ${item.count} / 4 · ${item.total} уровней`; text.append(title, detail);
        const button = document.createElement('button'); button.className = 'button secondary'; button.textContent = item.locked ? 'Пароль' : 'Играть'; button.addEventListener('click', () => chooseRoom(item)); card.append(text, button); list.append(card);
      }
    } catch (error) { $('online-list-status').textContent = error.message; }
    finally { if (opened && mode === 'find' && !active) listTimer = setTimeout(refreshRooms, document.hidden ? 15000 : 5000); }
  }
  async function chooseRoom(item) {
    if (!allowed) { invitation = item.id; signInLink(); notice('Войди и выбери ник, чтобы присоединиться.'); $('online-auth').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (item.locked) {
      selectedRoom = item; $('online-password-room').textContent = item.title; $('online-join-status').textContent = 'Пароль можно узнать у создателя комнаты.';
      $('online-join-password').value = ''; $('online-password-dialog').showModal(); return;
    }
    await action(async () => { setRoom(await post('/api/matches/' + item.id + '/join')); schedulePoll(20); }, error => { notice(error.message, true); refreshRooms(); });
  }
  async function open(next = 'find') {
    if (!canOpen() || active) return;
    opened = true; pane(next); $('online-dialog').showModal(); notice(next === 'create' ? 'Создай комнату для 2–4 игроков.' : 'Загружаем комнаты…');
    try {
      await access();
      if (allowed) {
        const current = await requestAPI('/api/matches/current');
        if (current.room) { setRoom(current.room); schedulePoll(20); return; }
        room = null;
      }
      pane(next); if (allowed && next === 'create') await packs();
      if (next === 'find') { refreshRooms(); ranking(); }
      if (invitation && allowed) {
        const id = invitation; invitation = null;
        const preview = await requestAPI('/api/matches/' + id + '/preview'); await chooseRoom(preview);
      } else notice(allowed ? next === 'create' ? 'Добавь пароль, если хочешь играть только со своими друзьями.' : 'Выбери комнату или создай свою.' : 'Для участия войди через ChatGPT и выбери ник.');
    } catch (error) { notice(error.message, true); }
  }
  function schedulePoll(delay = document.hidden ? 5000 : 1300) { clearTimeout(pollTimer); if (room && (opened || active)) pollTimer = setTimeout(poll, delay); }
  async function poll() {
    if (!room || !(opened || active)) return;
    const id = room.id, version = generation;
    try {
      const current = await requestAPI('/api/matches/' + id); if (generation !== version || room?.id !== id) return; setRoom(current);
      if (pending && room.phase === 'playing' && room.status === 'playing' && !room.you.answered && room.round === pending.round) { setRoom(await post(path('answer'), pending)); pending = null; }
      else if (pending && (room.you.answered || room.round !== pending.round || room.phase !== 'playing' || room.status !== 'playing')) pending = null;
    } catch (error) {
      lost = true; notice(error.message, true);
      if ([401, 403, 404].includes(error.status)) { leaveView(); await open('find'); notice(error.message, true); return; }
      if (active) render();
    } finally { schedulePoll(); }
  }
  function enterView() {
    active = true; opened = false; enter(); $('online-dialog').close(); $('duel-hud').hidden = false;
    clearTimeout(listTimer); clockTimer ||= setInterval(render, 100); render(); schedulePoll(20);
  }
  async function ready() {
    await action(async () => {
      if (!room) return;
      if (room.status === 'lobby' && room.you.ready) { localReady = false; setRoom(await post(path('ready'), { round: room.round, ready: false })); return; }
      await unlockAudio(); const expected = key(); stop();
      if (room.challenge && prepared !== expected) { await prepare(room.challenge); prepared = expected; }
      localReady = true;
      if (room.phase === 'preparing') setRoom(await post(path('ready'), { round: room.round })); else setRoom(await requestAPI(path()));
      if (room.status === 'playing' && !active) enterView(); schedulePoll(20);
    });
  }
  async function autoPrepare() {
    if (!active || !room?.you.active || room.status !== 'playing' || room.phase !== 'preparing') return;
    const expected = key(); if (preparing === expected || room.you.ready) return;
    preparing = expected; stop();
    try {
      if (prepared !== expected) { await prepare(room.challenge); prepared = expected; }
      if (active && key() === expected && room.phase === 'preparing') setRoom(await post(path('ready'), { round: room.round }));
    } catch (error) { lost = true; notice(error.message, true); stage('Не удалось загрузить уровень', error.message); }
    finally { if (preparing === expected) preparing = ''; }
  }
  function isPlayable() {
    const now = Date.now() + offset;
    return !!(active && room?.status === 'playing' && room.phase === 'playing' && room.you.active && !room.you.answered && !pending && !lost &&
      now >= room.startsAt && now < room.endsAt && prepared === key() && !document.hidden && !document.querySelector('dialog[open]'));
  }
  function stage(title, text, count = '', finished = false) {
    $('duel-stage').hidden = false; $('duel-stage-title').textContent = title; $('duel-stage-text').textContent = text;
    $('duel-stage-count').textContent = count; $('duel-result-actions').hidden = !finished;
  }
  function render() {
    if (!active || !room) return;
    activate(isPlayable()); $('duel-round').textContent = `${room.round} / ${room.total}`;
    const now = Date.now() + offset;
    if (lost) { $('duel-clock').textContent = 'Нет связи'; stage('Восстанавливаем связь', 'Проверяем состояние матча. Не закрывай страницу.'); return; }
    if (['finished', 'cancelled'].includes(room.status) || !room.you.active) {
      stop(); $('duel-clock').textContent = 'Итог';
      const ended = room.status === 'finished', outcome = room.you.outcome;
      const title = room.status === 'cancelled' ? 'Матч отменён' : !ended ? 'Ты вышел из матча' : outcome === 'win' ? 'Победа!' : outcome === 'draw' ? 'Ничья на первом месте' : 'Матч завершён';
      const rows = [...room.players].sort((a, b) => Number(b.active) - Number(a.active) || b.score - a.score).map(p => `${p.nickname}: ${p.score}${p.active ? '' : ' · вышел'}`).join('\n');
      stage(title, rows, ended ? room.you.score + ' очков' : '', true);
      $('duel-rematch').hidden = !ended; $('duel-rematch').textContent = room.rematchId ? 'Присоединиться к реваншу' : 'Реванш';
      $('duel-record-note').textContent = ended ? 'Результат учтён в рейтинге онлайн.' : room.status === 'cancelled' ? 'Отмена не влияет на рейтинг.' : 'Остальные продолжают игру. Результат сохранится после завершения матча.';
      return;
    }
    if (room.phase === 'preparing') { $('duel-clock').textContent = 'Загрузка'; stage('Готовимся к старту', room.you.ready ? 'Ты готов. Ждём загрузки у остальных…' : 'Загружаем картинки и звук…'); return; }
    if (room.phase === 'reveal') {
      $('duel-clock').textContent = 'Ответы'; if (revealed !== key() && room.result) { revealed = key(); reveal(room.result); }
      stage(room.result?.timedOut ? 'Время вышло' : room.result?.correct ? 'Верно! +100' : 'Не тот портал', `Это ${room.result?.meme.name || 'мем'}. Дальше через ${Math.max(1, Math.ceil((room.nextAt - now) / 1000))}…`); return;
    }
    if (now < room.startsAt) { $('duel-clock').textContent = 'Общий старт'; stage('Слушай и выбирай', 'Звук включится после отсчёта.', Math.max(1, Math.ceil((room.startsAt - now) / 1000))); return; }
    $('duel-clock').textContent = Math.max(0, Math.ceil((room.endsAt - now) / 1000)) + ' сек';
    if (room.you.answered || pending) { stage('Ответ принят', `Ждём ответы: ${room.players.filter(p => p.active && p.answered).length} / ${room.count}. Правильный мем откроется всем одновременно.`); return; }
    if (now >= room.endsAt) { stage('Время вышло', 'Получаем результаты…'); return; }
    if (prepared !== key()) { stage('Загружаем уровень', 'Подключаемся к матчу…'); return; }
    $('duel-stage').hidden = true; if (played !== key() && isPlayable()) { played = key(); play(); }
  }
  async function answer(index) {
    if (!isPlayable()) return; stop(); pending = { round: room.round, optionId: room.challenge.options[index].id, requestId: crypto.randomUUID() }; render();
    try { const data = await post(path('answer'), pending); pending = null; setRoom(data); }
    catch (error) { if (error.status === 409) { pending = null; await poll(); } else { lost = true; notice(error.message, true); render(); } }
    schedulePoll(20);
  }
  function leaveView(clear = true) {
    active = false; localReady = false; pending = null; generation++; clearTimeout(pollTimer); clearTimeout(listTimer); clearInterval(clockTimer); clockTimer = null;
    stop(); $('duel-hud').hidden = $('duel-stage').hidden = true; exit(); if (clear) room = null;
  }
  function askLeave() { if (active) { stop(); $('duel-leave-dialog').showModal(); } }
  $('find-games-button').addEventListener('click', () => open('find'));
  $('create-room-button').addEventListener('click', () => open('create'));
  $('online-close').addEventListener('click', () => $('online-dialog').close());
  $('online-dialog').addEventListener('close', () => { opened = false; clearTimeout(listTimer); if (!active) { clearTimeout(pollTimer); generation++; } });
  $('online-to-create').addEventListener('click', () => open('create'));
  $('online-to-find').addEventListener('click', () => open('find'));
  $('online-profile').addEventListener('click', () => account.openProfile());
  $('profile-dialog').addEventListener('close', () => { if (opened && !room) open(mode); });
  $('online-protected').addEventListener('change', () => {
    const locked = $('online-protected').checked; $('online-password-label').hidden = !locked; $('online-password').required = locked;
    $('online-password-note').textContent = locked ? 'Комната будет видна в списке с замком. Войти смогут только те, кто знает пароль.' : 'Комната появится в списке игр. Вместимость — до четырёх человек.';
    if (!locked) $('online-password').value = '';
  });
  $('online-create-form').addEventListener('submit', event => { event.preventDefault(); action(async () => {
    setRoom(await post('/api/matches', { title: $('online-title').value || undefined, pack: Number($('online-pack').value), password: $('online-protected').checked ? $('online-password').value : '' }));
    $('online-password').value = ''; $('online-password').blur(); schedulePoll(20);
  }); });
  $('online-join-form').addEventListener('submit', event => { event.preventDefault(); if (!selectedRoom) return;
    action(async () => { setRoom(await post('/api/matches/' + selectedRoom.id + '/join', { password: $('online-join-password').value })); $('online-join-password').value = ''; $('online-password-dialog').close(); selectedRoom = null; schedulePoll(20); }, error => { $('online-join-status').textContent = error.message; });
  });
  $('online-password-close').addEventListener('click', () => { $('online-password-dialog').close(); $('online-join-password').value = ''; selectedRoom = null; });
  $('online-ready').addEventListener('click', ready);
  $('online-start').addEventListener('click', () => action(async () => { setRoom(await post(path('start'))); schedulePoll(20); }));
  $('online-refresh').addEventListener('click', refreshRooms);
  $('online-ranking-refresh').addEventListener('click', ranking);
  $('online-share').addEventListener('click', async () => {
    const url = new URL(location.origin + '/'); url.searchParams.set('room', room.id);
    try { if (navigator.share) await navigator.share({ title: 'Игра мемов', text: room.title + (room.locked ? ' · пароль узнай у создателя' : ''), url: url.href }); else { await navigator.clipboard.writeText(url.href); notice('Ссылка скопирована. Пароль передай друзьям отдельно.'); } }
    catch (error) { if (error.name !== 'AbortError') notice('Приглашение: ' + url.href); }
  });
  $('online-lobby-leave').addEventListener('click', () => { if (room?.status === 'playing') { ready().then(askLeave); return; }
    action(async () => { await post(path('leave')); room = null; localReady = false; generation++; clearTimeout(pollTimer); await open('find'); });
  });
  $('online-exit').addEventListener('click', askLeave);
  $('duel-leave-cancel').addEventListener('click', () => { $('duel-leave-dialog').close(); render(); });
  $('duel-leave-confirm').addEventListener('click', () => action(async () => { await post(path('leave')); $('duel-leave-dialog').close(); leaveView(); }));
  $('duel-leave-dialog').addEventListener('close', render);
  $('duel-finish-home').addEventListener('click', () => leaveView());
  $('duel-rematch').addEventListener('click', () => action(async () => { const data = await post(path('rematch')); leaveView(false); room = null; setRoom(data); await open('lobby'); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) stop(); if (!document.hidden && (active || opened)) { if (room) schedulePoll(20); else if (mode === 'find') refreshRooms(); } });
  if (invitation || query.has('online')) open(query.get('online') === 'create' ? 'create' : 'find');
  return { answer, askLeave, suspend: stop, refresh: render, get active() { return active; }, get canPlay() { return isPlayable(); }, get challenge() { return room?.challenge; } };
}
