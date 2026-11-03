const $ = id => document.getElementById(id);
export async function requestAPI(path, options = {}, token) {
  const headers = new Headers(options.headers); if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('X-Game-Token', token);
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { response = await fetch(path, { ...options, headers, cache: 'no-store' }); break; }
    catch { if (attempt) throw Error('Нет соединения. Проверь интернет и попробуй ещё раз.'); }
  }
  let data; try { data = await response.json(); } catch { throw Error('Сервер пока не отвечает. Попробуй ещё раз.'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Не удалось сохранить изменения.'), { status: response.status });
  return data;
}
export const startRun = () => requestAPI('/api/runs', { method: 'POST', body: '{}' });
export async function answerRun(run, index) {
  const data = await requestAPI(`/api/runs/${run.runId}/answer`, { method: 'POST', body: JSON.stringify({
    optionId: run.challenge.options[index].id, revision: run.revision, requestId: crypto.randomUUID() }) }, run.token);
  return { ...data, token: run.token };
}
export async function currentRun(run) { return { ...await requestAPI('/api/runs/' + run.runId, {}, run.token), token: run.token }; }
export const finishRun = run => requestAPI(`/api/runs/${run.runId}/finish`, { method: 'POST', body: '{}' }, run.token);

export function initAccountUI({ onOpen, onClose, onProfile, onLevels }) {
  let me = { signedIn: false, profile: null, canManage: false };
  function render() {
    $('profile-label').textContent = me.profile?.nickname || (me.signedIn ? 'Выбрать ник' : 'Войти');
    $('profile-initial').textContent = me.profile ? me.profile.nickname[0].toUpperCase() : '◉';
    $('profile-button').setAttribute('aria-label', me.profile ? `Профиль: ${me.profile.nickname}` : 'Войти и выбрать ник');
    $('profile-guest').hidden = me.signedIn; $('profile-member').hidden = !me.signedIn;
    if (me.signedIn) {
      $('nickname').value = me.profile?.nickname || '';
      $('profile-score').textContent = me.profile?.bestScore || 0;
      $('profile-rooms').textContent = me.profile?.furthestRoom || 0;
      $('profile-games').textContent = me.profile?.gamesPlayed || 0;
    }
    onProfile(me);
  }
  async function refresh() { me = await requestAPI('/api/me'); render(); return me; }
  async function refreshLevels() {
    const data = await requestAPI('/api/levels'); onLevels(data); return data;
  }
  async function openProfile() {
    onOpen(); $('profile-dialog').showModal(); $('profile-status').textContent = 'Открываем профиль…';
    try { await refresh(); $('profile-status').textContent = me.signedIn ? 'Ник и рекорды сохраняются на всех твоих устройствах.' : 'Войди и выбери ник, чтобы попасть в общий рейтинг.'; }
    catch (error) { $('profile-status').textContent = error.message; }
  }
  $('profile-button').addEventListener('click', openProfile);
  $('profile-close').addEventListener('click', () => $('profile-dialog').close());
  $('profile-play').addEventListener('click', () => $('profile-dialog').close());
  $('profile-dialog').addEventListener('close', onClose);
  $('nickname-form').addEventListener('submit', async event => {
    event.preventDefault(); $('save-nickname').disabled = true;
    try {
      const data = await requestAPI('/api/profile', { method: 'PUT', body: JSON.stringify({ nickname: $('nickname').value }) });
      me.profile = data.profile; render(); $('nickname').blur(); $('profile-status').textContent = 'Ник сохранён! Теперь результаты будут попадать в рейтинг.';
    } catch (error) { $('profile-status').textContent = error.message; }
    finally { $('save-nickname').disabled = false; }
  });
  async function openRanking() {
    onOpen(); $('ranking-dialog').showModal(); $('ranking-status').textContent = 'Загружаем рейтинг…';
    try {
      const data = await requestAPI('/api/leaderboard'); const list = $('ranking-list'); list.replaceChildren();
      $('ranking-status').textContent = data.rows.length ? 'Лучший результат каждого игрока. Очки считает сервер.' : 'Пока нет результатов. Сыграй первую партию с ником!';
      $('ranking-mine').hidden = !data.you;
      if (data.you) $('ranking-mine').textContent = data.you.rank ? `Твоё место: ${data.you.rank} · ${data.you.bestScore} очков` : 'Твой первый результат появится после партии.';
      for (const row of data.rows) {
        const item = document.createElement('li'); item.className = 'ranking-row' + (row.isYou ? ' is-you' : '');
        for (const [className, text] of [['rank-number', row.rank], ['rank-name', row.nickname], ['rank-points', row.score]]) {
          const span = document.createElement('span'); span.className = className; span.textContent = String(text); item.append(span);
        }
        const detail = document.createElement('small'); detail.textContent = `${row.rooms} комнат`; item.append(detail); list.append(item);
      }
      $('ranking-profile').hidden = !!data.you;
    } catch (error) { $('ranking-status').textContent = error.message; }
  }
  for (const id of ['home-ranking', 'finish-ranking', 'profile-ranking', 'profile-guest-ranking']) $(id).addEventListener('click', openRanking);
  $('ranking-close').addEventListener('click', () => $('ranking-dialog').close());
  $('ranking-dialog').addEventListener('close', onClose);
  $('ranking-refresh').addEventListener('click', openRanking);
  $('ranking-profile').addEventListener('click', () => { $('ranking-dialog').close(); openProfile(); });
  $('finish-profile').addEventListener('click', openProfile);
  if (new URLSearchParams(location.search).has('profile')) { history.replaceState(null, '', location.pathname); openProfile(); }
  return { refresh, refreshLevels, openProfile, get current() { return me; } };
}
