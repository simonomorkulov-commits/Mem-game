export async function handleBannerApi(request, env, { canManage, boundedBody, imageType, fail, json }) {
  if (!env.BUCKET) fail('Баннер пока недоступен.', 503);
  const current = await env.BUCKET.get('banner/current.json');
  const previous = current ? await current.json() : null;
  if (request.method === 'GET') return json({ banner: previous, canManage: canManage(request, env) });
  if (!canManage(request, env)) fail('Изменять баннер может только автор игры.', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) fail('Открой игру на её сайте.', 403);
  if (request.method === 'DELETE') {
    await env.BUCKET.delete('banner/current.json');
    if (previous?.id) await env.BUCKET.delete('banners/' + previous.id);
    return json({ banner: null, canManage: true });
  }
  if (request.method !== 'POST') fail('Метод не поддерживается.', 405);
  const bytes = await boundedBody(request);
  const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
  const image = form.get('image'), title = String(form.get('title') || 'Реклама').trim(), link = String(form.get('link') || '').trim();
  if (!title || title.length > 80) fail('Подпись — от 1 до 80 символов.');
  if (link) {
    let url; try { url = new URL(link); } catch { fail('Укажи полную ссылку с https://.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || link.length > 2048) fail('Подходит только обычная ссылка http:// или https://.');
  }
  if (!image?.arrayBuffer || !image.size || image.size > 2 * 1024 * 1024) fail('Выбери картинку JPG, PNG, WebP или GIF до 2 МБ.');
  const imageBytes = new Uint8Array(await image.arrayBuffer()), type = imageType(imageBytes), id = crypto.randomUUID();
  const banner = { id, image: '/banner-media/' + id, title, link };
  try {
    await env.BUCKET.put('banners/' + id, imageBytes, { httpMetadata: { contentType: type } });
    await env.BUCKET.put('banner/current.json', JSON.stringify(banner), { httpMetadata: { contentType: 'application/json' } });
  } catch (error) { await env.BUCKET.delete('banners/' + id).catch(() => {}); throw error; }
  if (previous?.id) await env.BUCKET.delete('banners/' + previous.id).catch(() => {});
  return json({ banner, canManage: true }, 201);
}
