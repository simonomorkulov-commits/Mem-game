import { requestAPI } from './account.js';

export function initOnlinePresence() {
  const tabId = crypto.randomUUID();
  const visitorKey = 'igra-memov:visitor:v1';
  let visitorToken;
  try { visitorToken = localStorage.getItem(visitorKey); } catch {}
  if (!/^[a-f0-9]{64}$/.test(visitorToken || '')) {
    visitorToken = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(visitorKey, visitorToken); } catch {}
  }
  let registered = false, busy = false, queued = false, timer, leaving = false;
  function paint(total) {
    for (const element of document.querySelectorAll('[data-online-count]')) element.textContent = String(total);
    for (const element of document.querySelectorAll('[data-online-state]')) element.dataset.onlineState = 'ready';
  }
  async function refresh() {
    clearTimeout(timer);
    if (busy) { queued = true; return; }
    busy = true;
    try {
      const count = !document.hidden && !leaving;
      if (count || registered) {
        const data = await requestAPI('/api/matches/presence', { method: count ? 'POST' : 'DELETE', body: JSON.stringify({ tabId, visitorToken }), keepalive: !count });
        registered = count; paint(data.online);
      }
    } catch {
      for (const element of document.querySelectorAll('[data-online-count]')) element.textContent = '—';
      for (const element of document.querySelectorAll('[data-online-state]')) element.dataset.onlineState = 'unavailable';
    } finally {
      busy = false;
      if (queued) { queued = false; refresh(); }
      else if (!document.hidden && !leaving) timer = setTimeout(refresh, 10000);
    }
  }
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('storage', event => {
    if (event.key === visitorKey) {
      try { const current = localStorage.getItem(visitorKey); if (/^[a-f0-9]{64}$/.test(current || '')) visitorToken = current; } catch {}
    }
    if (event.key === visitorKey || event.key === 'igra-memov:player-token:v1') refresh();
  });
  window.addEventListener('pagehide', () => { leaving = true; refresh(); });
  window.addEventListener('pageshow', () => { leaving = false; refresh(); });
  refresh();
  return { refresh };
}
