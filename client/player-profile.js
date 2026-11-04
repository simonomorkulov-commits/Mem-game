import { acceptPlayerToken, preparePlayerToken, forgetPlayerToken, rememberNickname, rememberedNickname } from './player-session.js';

const $ = id => document.getElementById(id);
export function createProfileUI({ api, onOpen, onClose, onProfile, onLevels }) {
  let me = { signedIn: false, profile: null, canManage: false, auth: { mode: 'none', hasPassword: false } }, afterSave = null, retaining = null;
  function render() {
    $('profile-label').textContent = me.profile?.nickname || 'Выбрать ник';
    $('profile-initial').textContent = me.profile ? me.profile.nickname[0].toUpperCase() : '◉';
    $('profile-button').setAttribute('aria-label', me.profile ? 'Профиль: ' + me.profile.nickname : 'Выбрать и сохранить ник');
    $('profile-guest').hidden = !!me.profile; $('profile-member').hidden = !me.profile;
    if (me.profile) {
      rememberNickname(me.profile.nickname); $('nickname').value = me.profile.nickname;
      $('profile-score').textContent = me.profile.bestScore; $('profile-rooms').textContent = me.profile.furthestRoom; $('profile-games').textContent = me.profile.gamesPlayed;
      const protectedAccount = !!me.auth?.hasPassword;
      $('profile-device-note').textContent = protectedAccount ? 'Ник и рекорды сохранены. На другом устройстве войди с этим ником и паролем.' : 'Ник сохранён на этом устройстве. Для входа с другого телефона добавь пароль ниже.';
      $('password-summary').textContent = protectedAccount ? 'Изменить пароль' : 'Добавить пароль для другого телефона';
      $('current-password-field').hidden = !protectedAccount; $('current-password').required = protectedAccount;
      $('local-signout').hidden = !protectedAccount;
    } else if (!$('guest-nickname').value) $('guest-nickname').value = rememberedNickname();
    onProfile(me);
  }
  async function refresh() {
    let data = await api('/api/me');
    if (data.auth?.mode === 'legacy' && data.profile) {
      retaining ||= api('/api/auth/retain', { method: 'POST', body: '{}' }).then(result => { acceptPlayerToken(result.token); return api('/api/me'); }).finally(() => { retaining = null; });
      data = await retaining;
    }
    me = data; render(); return me;
  }
  async function refreshLevels() { const data = await api('/api/levels'); onLevels(data); return data; }
  async function openProfile(callback) {
    afterSave = typeof callback === 'function' ? callback : null;
    onOpen(); $('profile-dialog').showModal(); $('profile-status').textContent = 'Открываем профиль…';
    try { await refresh(); $('profile-status').textContent = me.profile ? 'Твой ник и рекорды сохранены.' : 'Выбери ник один раз — в следующий раз игра узнает тебя.'; }
    catch (error) { $('profile-status').textContent = error.message; }
  }
  async function finishSignIn(data) {
    acceptPlayerToken(data.token); await refresh();
    $('guest-nickname').blur(); $('login-password').value = ''; $('login-nickname').blur();
    const callback = afterSave; afterSave = null; $('profile-dialog').close();
    if (callback) await callback();
  }
  $('profile-button').addEventListener('click', () => openProfile());
  $('profile-close').addEventListener('click', () => $('profile-dialog').close());
  $('profile-play').addEventListener('click', () => $('profile-dialog').close());
  $('profile-dialog').addEventListener('close', () => { afterSave = null; onClose(); });
  $('guest-profile-form').addEventListener('submit', async event => {
    event.preventDefault(); $('save-guest-profile').disabled = true; $('profile-status').textContent = 'Сохраняем ник…';
    try { preparePlayerToken(); await finishSignIn(await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ nickname: $('guest-nickname').value }) })); }
    catch (error) { $('profile-status').textContent = error.message; }
    finally { $('save-guest-profile').disabled = false; }
  });
  $('local-login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('local-login-button').disabled = true; $('profile-status').textContent = 'Открываем твой профиль…';
    try { await finishSignIn(await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ nickname: $('login-nickname').value, password: $('login-password').value }) })); }
    catch (error) { $('profile-status').textContent = error.message; }
    finally { $('local-login-button').disabled = false; }
  });
  $('nickname-form').addEventListener('submit', async event => {
    event.preventDefault(); $('save-nickname').disabled = true;
    try { const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ nickname: $('nickname').value }) }); me.profile = data.profile; render(); $('nickname').blur(); $('profile-status').textContent = 'Ник изменён. Рекорды остались в твоём профиле.'; }
    catch (error) { $('profile-status').textContent = error.message; }
    finally { $('save-nickname').disabled = false; }
  });
  $('local-password-form').addEventListener('submit', async event => {
    event.preventDefault(); $('save-local-password').disabled = true;
    try {
      const data = await api('/api/auth/password', { method: 'PUT', body: JSON.stringify({ password: $('new-password').value, currentPassword: $('current-password').value }) });
      acceptPlayerToken(data.token); $('new-password').value = $('current-password').value = ''; $('new-password').blur(); await refresh();
      $('password-details').open = false; $('profile-status').textContent = 'Пароль сохранён. Теперь с этим ником можно войти на другом телефоне.';
    } catch (error) { $('profile-status').textContent = error.message; }
    finally { $('save-local-password').disabled = false; }
  });
  $('local-signout').addEventListener('click', async () => {
    $('local-signout').disabled = true;
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); forgetPlayerToken(); await refresh(); $('login-details').open = true; $('profile-status').textContent = 'Ты вышел. Ник и рекорды сохранены — войди с паролем, чтобы вернуться.'; }
    catch (error) { $('profile-status').textContent = error.message; }
    finally { $('local-signout').disabled = false; }
  });
  async function openRanking() {
    onOpen(); $('ranking-dialog').showModal(); $('ranking-status').textContent = 'Загружаем рейтинг…';
    try {
      const data = await api('/api/leaderboard'), list = $('ranking-list'); list.replaceChildren();
      $('ranking-status').textContent = data.rows.length ? 'Лучший результат каждого игрока.' : 'Пока нет результатов. Выбери ник и сыграй первую партию!';
      $('ranking-mine').hidden = !data.you;
      if (data.you) $('ranking-mine').textContent = data.you.rank ? `Твоё место: ${data.you.rank} · ${data.you.bestScore} очков` : 'Твой первый результат появится после партии.';
      for (const row of data.rows) {
        const item = document.createElement('li'); item.className = 'ranking-row' + (row.isYou ? ' is-you' : '');
        for (const [cls, text] of [['rank-number', row.rank], ['rank-name', row.nickname], ['rank-points', row.score]]) { const span = document.createElement('span'); span.className = cls; span.textContent = String(text); item.append(span); }
        const detail = document.createElement('small'); detail.textContent = row.rooms + ' комнат'; item.append(detail); list.append(item);
      }
      $('ranking-profile').hidden = !!data.you;
    } catch (error) { $('ranking-status').textContent = error.message; }
  }
  for (const id of ['home-ranking', 'finish-ranking', 'profile-ranking', 'profile-guest-ranking']) $(id).addEventListener('click', openRanking);
  $('ranking-close').addEventListener('click', () => $('ranking-dialog').close()); $('ranking-dialog').addEventListener('close', onClose); $('ranking-refresh').addEventListener('click', openRanking);
  $('ranking-profile').addEventListener('click', () => { $('ranking-dialog').close(); openProfile(); }); $('finish-profile').addEventListener('click', () => openProfile());
  if (new URLSearchParams(location.search).has('profile')) { const url = new URL(location.href); url.searchParams.delete('profile'); history.replaceState(null, '', url.pathname + url.search); openProfile(); }
  return { refresh, refreshLevels, openProfile, get current() { return me; } };
}
