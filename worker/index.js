import { MEMES as BUILTIN_MEMES } from '../client/data.js';
import { handleGameApi } from './game-api.js';

const ASSETS = {}; // Replaced by scripts/build.mjs for the single-file Worker.
const MAX_BODY = 13 * 1024 * 1024;
const ID = /^[a-f0-9-]{36}$/;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function canManage(request, env) {
  const email = request.headers.get('oai-authenticated-user-email');
  return !!env.MEME_ADMIN_EMAIL && !!email && email.toLowerCase() === env.MEME_ADMIN_EMAIL.toLowerCase();
}
async function records(bucket) {
  const keys = []; let cursor;
  do {
    const page = await bucket.list({ prefix: 'records/', cursor, limit: 1000 });
    keys.push(...page.objects.map(o => o.key)); cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const all = await Promise.all(keys.map(async key => { const obj = await bucket.get(key); return obj ? obj.json() : null; }));
  return all.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function settings(bucket) {
  const obj = await bucket.get('settings.json');
  return obj ? obj.json() : { includeBuiltins: true };
}
async function boundedBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) fail('Файлы слишком большие. Картинка — до 4 МБ, звук — до 8 МБ.', 413);
  const reader = request.body?.getReader(); if (!reader) fail('Выбери картинку и звук.');
  const chunks = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); fail('Файлы слишком большие.', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  const s = new TextDecoder().decode(bytes.slice(0, 12));
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
  if (s.startsWith('GIF87a') || s.startsWith('GIF89a')) return 'image/gif';
  fail('Не удалось прочитать картинку. Выбери JPG, PNG, WebP или GIF.');
}
function audioType(bytes) {
  const s = new TextDecoder().decode(bytes.slice(0, 12));
  if (s.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (s.startsWith('OggS')) return 'audio/ogg';
  if (s.slice(4, 8) === 'ftyp') return 'audio/mp4';
  fail('Не удалось прочитать звук. Выбери MP3, WAV, OGG или M4A.');
}
async function upload(request, env) {
  const body = await boundedBody(request);
  const form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
  const name = String(form.get('name') || '').trim();
  const image = form.get('image'), audio = form.get('audio');
  const duration = Number(form.get('duration'));
  if (!name || name.length > 60) fail('Название должно содержать от 1 до 60 символов.');
  if (!image?.arrayBuffer || !audio?.arrayBuffer) fail('Нужны и картинка, и звук.');
  if (!image.size || image.size > 4 * 1024 * 1024 || !audio.size || audio.size > 8 * 1024 * 1024) fail('Картинка — до 4 МБ, звук — до 8 МБ.', 413);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 20) fail('Выбери звук длиной до 20 секунд.');
  const items = await records(env.BUCKET); if (items.length >= 100) fail('В коллекции уже 100 мемов. Удали ненужный, чтобы добавить новый.');
  const imageBytes = new Uint8Array(await image.arrayBuffer()), audioBytes = new Uint8Array(await audio.arrayBuffer());
  const imgType = imageType(imageBytes), sndType = audioType(audioBytes);
  const id = crypto.randomUUID();
  const record = { id, name, image: `/media/${id}/image`, audio: `/media/${id}/audio`, duration,
    createdAt: new Date().toISOString(), color: '#b9ff66', custom: true };
  const keys = [`media/${id}/image`, `media/${id}/audio`, `records/${id}.json`];
  try {
    await env.BUCKET.put(keys[0], imageBytes, { httpMetadata: { contentType: imgType } });
    await env.BUCKET.put(keys[1], audioBytes, { httpMetadata: { contentType: sndType } });
    await env.BUCKET.put(keys[2], JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
  } catch (error) { await env.BUCKET.delete(keys).catch(() => {}); throw error; }
  return json({ meme: record }, 201);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url), pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        if (/^\/api\/(me|profile|leaderboard|levels|runs|duels|matches)(\/|$)/.test(pathname)) {
          return await handleGameApi(request, env, { canManage, catalog: async () => {
            if (!env.BUCKET) fail('Коллекция пока недоступна.', 503);
            const [custom, config] = await Promise.all([records(env.BUCKET), settings(env.BUCKET)]);
            return { all: [...custom, ...BUILTIN_MEMES], memes: config.includeBuiltins !== false || custom.length < 3 ? [...custom, ...BUILTIN_MEMES] : custom };
          } });
        }
        if (!env.BUCKET) return json({ error: 'Коллекция пока недоступна. Попробуй чуть позже.' }, 503);
        if (request.method !== 'GET') {
          if (!canManage(request, env)) return json({ error: 'Добавлять и удалять мемы может только автор игры. Войди в свой аккаунт.' }, 403);
          const origin = request.headers.get('origin');
          if (origin && origin !== url.origin) return json({ error: 'Открой коллекцию на сайте игры.' }, 403);
        }
        if (pathname === '/api/memes' && request.method === 'GET') {
          const [custom, config] = await Promise.all([records(env.BUCKET), settings(env.BUCKET)]);
          const includeBuiltins = config.includeBuiltins !== false || custom.length < 3;
          return json({ custom, includeBuiltins, canManage: canManage(request, env),
            memes: includeBuiltins ? [...custom, ...BUILTIN_MEMES] : custom });
        }
        if (pathname === '/api/memes' && request.method === 'POST') return await upload(request, env);
        const deletion = pathname.match(/^\/api\/memes\/([a-f0-9-]{36})$/);
        if (deletion && request.method === 'DELETE') {
          const id = deletion[1]; if (!(await env.BUCKET.get(`records/${id}.json`))) return json({ error: 'Этот мем уже удалён.' }, 404);
          if (env.DB && await env.DB.prepare('SELECT id FROM game_levels WHERE active = 1 AND (target_id = ? OR option_a = ? OR option_b = ? OR option_c = ?) LIMIT 1').bind(id, id, id, id).first()) {
            fail('Этот мем используется в уровнях. Сначала измени или удали эти уровни.', 409);
          }
          await env.BUCKET.delete(`records/${id}.json`);
          await env.BUCKET.delete([`media/${id}/image`, `media/${id}/audio`]);
          if ((await records(env.BUCKET)).length < 3) await env.BUCKET.put('settings.json', JSON.stringify({ includeBuiltins: true }));
          return json({ deleted: true });
        }
        if (pathname === '/api/settings' && request.method === 'PUT') {
          const bytes = await boundedBody(request); if (bytes.length > 200) fail('Неверные настройки.');
          const config = JSON.parse(new TextDecoder().decode(bytes));
          if (typeof config.includeBuiltins !== 'boolean') fail('Неверные настройки.');
          if (!config.includeBuiltins && (await records(env.BUCKET)).length < 3) fail('Для игры только со своими мемами добавь минимум 3 пары «картинка + звук».');
          await env.BUCKET.put('settings.json', JSON.stringify({ includeBuiltins: config.includeBuiltins }));
          return json({ saved: true });
        }
        return json({ error: 'Не найдено.' }, 404);
      }
      const media = pathname.match(/^\/media\/([^/]+)\/(image|audio)$/);
      if (media) {
        if (!ID.test(media[1]) || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
        const object = await env.BUCKET?.get(`media/${media[1]}/${media[2]}`);
        if (!object) return new Response('Not found', { status: 404 });
        return new Response(request.method === 'HEAD' ? null : object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      const asset = ASSETS[pathname === '/' ? '/index.html' : pathname];
      if (!asset) return new Response('Not found', { status: 404 });
      const body = asset.binary ? Uint8Array.from(atob(asset.content), c => c.charCodeAt(0)) : asset.content;
      return new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': asset.type,
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
      if (!error.status) console.error('Meme API:', error.message);
      return json({ error: error.status ? error.message : 'Не удалось сохранить изменения. Попробуй ещё раз.' }, error.status || 500);
    }
  }
};
