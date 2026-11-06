import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';
import { LocalDB } from '../scripts/local-db.mjs';
class BannerBucket {
  objects = new Map();
  async put(key, value, options = {}) { this.objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), metadata: options.httpMetadata }); }
  async get(key) { const obj = this.objects.get(key); return obj ? { body: obj.bytes, httpMetadata: obj.metadata, json: async () => JSON.parse(new TextDecoder().decode(obj.bytes)) } : null; }
  async delete(key) { this.objects.delete(key); }
}
const owner = 'owner@example.test';
const setup = () => ({ BUCKET: new BannerBucket(), MEME_ADMIN_EMAIL: owner });
function call(env, method = 'GET', body, identity, origin, path = '/api/banner') {
  const headers = new Headers(); if (identity) headers.set('oai-authenticated-user-email', identity); if (origin) headers.set('Origin', origin);
  return worker.fetch(new Request('https://game.test' + path, { method, headers, ...(body === undefined ? {} : { body }) }), env);
}
async function form(link = 'https://example.com', bytes) {
  const data = new FormData(); data.set('title', 'Местное кафе'); data.set('link', link);
  data.set('image', new Blob([bytes || await readFile(new URL('../client/assets/rock.jpg', import.meta.url))], { type: 'image/jpeg' }), 'banner.jpg'); return data;
}
test('Only the owner can publish a shared banner; public readers receive the image, title and link', async () => {
  const env = setup(); assert.deepEqual(await (await call(env)).json(), { banner: null, enabled: true, canManage: false });
  assert.equal((await call(env, 'POST', await form())).status, 403);
  assert.equal((await call(env, 'DELETE', undefined, 'other@example.test')).status, 403);
  const added = await call(env, 'POST', await form(), owner); assert.equal(added.status, 201);
  const banner = (await added.json()).banner;
  assert.equal((await (await call(env)).json()).banner.link, 'https://example.com');
  const image = await call(env, 'GET', undefined, undefined, undefined, banner.image); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call(env, 'HEAD', undefined, undefined, undefined, banner.image)).status, 200);
});

test('Only the owner can toggle advertising; disabled state survives upload, deletion and later reads', async () => {
  const env = setup(), settings = value => JSON.stringify({ enabled: value });
  assert.equal((await call(env, 'PATCH', settings(false))).status, 403);
  assert.equal((await call(env, 'PATCH', settings(false), 'other@example.test')).status, 403);
  assert.equal((await call(env, 'PATCH', settings(false), owner, 'https://elsewhere.test')).status, 403);
  assert.equal((await call(env, 'PATCH', settings('false'), owner)).status, 400);
  const disabled = await call(env, 'PATCH', settings(false), owner); assert.equal(disabled.status, 200); assert.equal((await disabled.json()).enabled, false);
  assert.equal((await (await call(env, 'POST', await form(), owner)).json()).enabled, false);
  assert.equal((await (await call(env, 'DELETE', undefined, owner)).json()).enabled, false);
  assert.deepEqual(await (await call(env)).json(), { banner: null, enabled: false, canManage: false });
  await call(env, 'PATCH', settings(true), owner); assert.deepEqual(await (await call(env)).json(), { banner: null, enabled: true, canManage: false });
});
test('Replacing or removing a banner removes the old asset without changing memes', async () => {
  const env = setup();
  const first = (await (await call(env, 'POST', await form(), owner)).json()).banner;
  const second = (await (await call(env, 'POST', await form(''), owner)).json()).banner;
  assert.notEqual(first.id, second.id); assert.equal(second.link, ''); assert.equal(env.BUCKET.objects.has('banners/' + first.id), false);
  assert.equal(env.BUCKET.objects.size, 2);
  assert.equal((await call(env, 'DELETE', undefined, owner)).status, 200);
  assert.equal((await (await call(env)).json()).banner, null); assert.equal(env.BUCKET.objects.size, 0);
});
test('Unsafe links, HTML images, oversized uploads and cross-origin writes cannot publish a banner', async () => {
  const env = setup();
  assert.equal((await call(env, 'POST', await form('javascript:alert(1)'), owner)).status, 400);
  assert.equal((await call(env, 'POST', await form('https://example.com', new TextEncoder().encode('<svg onload="alert(1)"/>')), owner)).status, 400);
  assert.equal((await call(env, 'POST', await form('', new Uint8Array(2 * 1024 * 1024 + 1)), owner)).status, 400);
  assert.equal((await call(env, 'POST', await form(), owner, 'https://elsewhere.test')).status, 403);
  assert.equal(env.BUCKET.objects.size, 0);
});

test('Saved owner token can change advertising; a normal nickname and forged admin fields cannot', async () => {
  const env = { ...setup(), DB: new LocalDB() };
  async function api(path, method, data, headers = {}) {
    return worker.fetch(new Request('https://game.test' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) }), env);
  }
  try {
    const ownerHeaders = { 'oai-authenticated-user-id': 'real-owner', 'oai-authenticated-user-email': owner };
    assert.equal((await api('/api/profile', 'PUT', { nickname: 'Автор' }, ownerHeaders)).status, 200);
    const retained = await api('/api/auth/retain', 'POST', {}, ownerHeaders), ownerToken = (await retained.json()).token;
    assert.equal((await api('/api/banner', 'PATCH', { enabled: false }, { 'X-Player-Token': ownerToken })).status, 200);
    const guestResponse = await api('/api/auth/guest', 'POST', { nickname: 'Игрок', isAdmin: true }), guestToken = (await guestResponse.json()).token;
    assert.equal((await api('/api/banner', 'PATCH', { enabled: true, isAdmin: true, canManage: true }, { 'X-Player-Token': guestToken })).status, 403);
    assert.equal((await (await call(env)).json()).enabled, false);
  } finally { env.DB.close(); }
});
