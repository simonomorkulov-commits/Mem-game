import { accountHash } from './account-api.js';
const PRESENCE_TTL_MS = 45000;
export async function handlePresenceApi(request, env, { user, profile, body }) {
  const now = Date.now();
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return Response.json({ error: 'Метод не поддерживается.' }, { status: 405 });
  if (request.method !== 'GET') {
    const { tabId, visitorToken } = await body(request);
    if (visitorToken === undefined && (!user || !profile)) throw Object.assign(new Error('Сначала выбери ник.'), { status: 401 });
    if (typeof tabId !== 'string' || !/^[a-f0-9-]{36}$/.test(tabId)) throw Object.assign(new Error('Неверная вкладка.'), { status: 400 });
    if (visitorToken !== undefined) {
      if (typeof visitorToken !== 'string' || !/^[a-f0-9]{64}$/.test(visitorToken)) throw Object.assign(new Error('Неверный посетитель.'), { status: 400 });
      const visitorHash = await accountHash('presence:' + visitorToken);
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM visitor_presence WHERE visitor_hash = ? AND tab_id = ?').bind(visitorHash, tabId).run();
      } else {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM visitor_presence WHERE seen_at <= ?').bind(now - PRESENCE_TTL_MS),
          env.DB.prepare('INSERT INTO visitor_presence (visitor_hash, tab_id, player_id, seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(visitor_hash, tab_id) DO UPDATE SET player_id = excluded.player_id, seen_at = excluded.seen_at').bind(visitorHash, tabId, profile ? user : null, now)
        ]);
      }
    } else if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM online_presence WHERE player_id = ? AND tab_id = ?').bind(user, tabId).run();
    } else {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM online_presence WHERE seen_at <= ?').bind(now - PRESENCE_TTL_MS),
        env.DB.prepare('INSERT INTO online_presence (player_id, tab_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(player_id, tab_id) DO UPDATE SET seen_at = excluded.seen_at').bind(user, tabId, now)
      ]);
    }
  }
  const row = await env.DB.prepare("SELECT COUNT(DISTINCT subject) AS total FROM (SELECT player_id AS subject FROM online_presence WHERE seen_at > ? UNION ALL SELECT COALESCE(player_id, 'visitor:' || visitor_hash) AS subject FROM visitor_presence WHERE seen_at > ?)").bind(now - PRESENCE_TTL_MS, now - PRESENCE_TTL_MS).first();
  return Response.json({ online: row.total }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
