import { requestAPI } from './account.js';

export function initOnlinePresence(shouldCount) {
  const tabId = crypto.randomUUID();
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
      const visible = !document.hidden && !leaving, count = visible && shouldCount();
      if (count || registered) {
        const data = await requestAPI('/api/matches/presence', { method: count ? 'POST' : 'DELETE', body: JSON.stringify({ tabId }), keepalive: !count });
        registered = count; paint(data.online);
      } else if (visible) paint((await requestAPI('/api/matches/presence')).online);
    } catch {
      for (const element of document.querySelectorAll('[data-online-count]')) element.textContent = '—';
      for (const element of document.querySelectorAll('[data-online-state]')) element.dataset.onlineState = 'unavailable';
    } finally {
      busy = false;
      if (queued) { queued = false; refresh(); }
      else if (!document.hidden && !leaving) timer = setTimeout(refresh, 15000);
    }
  }
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pagehide', () => { leaving = true; refresh(); });
  window.addEventListener('pageshow', () => { leaving = false; refresh(); });
  refresh();
  return { refresh };
}
