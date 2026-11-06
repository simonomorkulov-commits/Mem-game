const PRESENCE_TTL_MS = 45000;
export async function handlePresenceApi(request, env, { user, profile, body }) {
  const now = Date.now();
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return Response.json({ error: 'Метод не поддерживается.' }, { status: 405 });
  if (request.method !== 'GET') {
    if (!user || !profile) throw Object.assign(new Error('Сначала выбери ник.'), { status: 401 });
    const { tabId } = await body(request);
    if (typeof tabId !== 'string' || !/^[a-f0-9-]{36}$/.test(tabId)) throw Object.assign(new Error('Неверная вкладка.'), { status: 400 });
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM online_presence WHERE player_id = ? AND tab_id = ?').bind(user, tabId).run();
    } else {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM online_presence WHERE seen_at <= ?').bind(now - PRESENCE_TTL_MS),
        env.DB.prepare('INSERT INTO online_presence (player_id, tab_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(player_id, tab_id) DO UPDATE SET seen_at = excluded.seen_at').bind(user, tabId, now)
      ]);
    }
  }
  const row = await env.DB.prepare('SELECT COUNT(DISTINCT player_id) AS total FROM online_presence WHERE seen_at > ?').bind(now - PRESENCE_TTL_MS).first();
  return Response.json({ online: row.total }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
