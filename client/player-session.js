const TOKEN_KEY = 'igra-memov:player-token:v1', SKIP_KEY = 'igra-memov:skip-legacy:v1', NAME_KEY = 'igra-memov:nickname:v1';
let token = null, skipLegacy = false;
try { const saved = localStorage.getItem(TOKEN_KEY); if (/^[a-f0-9]{64}$/.test(saved || '')) token = saved; skipLegacy = localStorage.getItem(SKIP_KEY) === '1'; } catch {}
export function preparePlayerToken() {
  if (!token) {
    token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  }
}
export function acceptPlayerToken(value) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw Error('Не удалось сохранить вход. Попробуй ещё раз.');
  token = value; skipLegacy = true;
  try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(SKIP_KEY, '1'); } catch {}
}
export function forgetPlayerToken() {
  token = null; skipLegacy = true;
  try { localStorage.removeItem(TOKEN_KEY); localStorage.setItem(SKIP_KEY, '1'); } catch {}
}
export function rememberNickname(name) { try { localStorage.setItem(NAME_KEY, name); } catch {} }
export function rememberedNickname() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
export function authenticatedFetch(url, options = {}) {
  const headers = new Headers(options.headers); if (token) headers.set('X-Player-Token', token); if (skipLegacy) headers.set('X-Skip-Legacy', '1');
  return fetch(url, { ...options, headers, credentials: 'same-origin' });
}
