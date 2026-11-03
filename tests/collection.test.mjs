import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';
import { newGame, answer, nextRound } from '../client/game.js';
import { joystickVector } from '../client/joystick.js';

class MemoryBucket {
  objects = new Map();
  async put(key, value, options = {}) { this.objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), metadata: options.httpMetadata }); }
  async get(key) { const item = this.objects.get(key); return item ? { body: item.bytes, httpMetadata: item.metadata, json: async () => JSON.parse(new TextDecoder().decode(item.bytes)) } : null; }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
  async list({ prefix }) { return { objects: [...this.objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }; }
}
const admin = 'owner@example.test';
function call(env, pathname, options = {}, identity = admin) {
  const headers = new Headers(options.headers); if (identity) headers.set('oai-authenticated-user-email', identity);
  return worker.fetch(new Request('https://game.example' + pathname, { ...options, headers }), env);
}
async function upload(env, name = 'Мой мем', identity = admin, picture) {
  const form = new FormData(); form.set('name', name); form.set('duration', '0.817');
  form.set('image', new Blob([picture || await readFile(new URL('../client/assets/rock.jpg', import.meta.url))], { type: 'image/jpeg' }), 'image.jpg');
  form.set('audio', new Blob([await readFile(new URL('../client/assets/bruh.mp3', import.meta.url))], { type: 'audio/mpeg' }), 'audio.mp3');
  return call(env, '/api/memes', { method: 'POST', body: form }, identity);
}
test('Public visitors can play but cannot upload, change settings, or delete memes', async () => {
  const env = { BUCKET: new MemoryBucket(), MEME_ADMIN_EMAIL: admin };
  const publicCatalog = await (await call(env, '/api/memes', {}, null)).json();
  assert.equal(publicCatalog.canManage, false); assert.equal(publicCatalog.memes.length, 6);
  assert.equal((await upload(env, 'Чужой', null)).status, 403);
  assert.equal((await upload(env, 'Чужой', 'other@example.test')).status, 403);
  assert.equal((await call(env, '/api/settings', { method: 'PUT', body: '{}' }, null)).status, 403);
  assert.equal((await call(env, '/api/memes/00000000-0000-0000-0000-000000000000', { method: 'DELETE' }, null)).status, 403);
  assert.equal(env.BUCKET.objects.size, 0);
});
test('Owner uploads persist for other clients, media is served, and custom-only mode remains playable after deletion', async () => {
  const env = { BUCKET: new MemoryBucket(), MEME_ADMIN_EMAIL: admin };
  const ids = [];
  for (let i = 0; i < 3; i++) { const response = await upload(env, `Мем ${i}`); assert.equal(response.status, 201); ids.push((await response.json()).meme.id); }
  const catalog = await (await call(env, '/api/memes', {}, null)).json();
  assert.equal(catalog.custom.length, 3); assert.equal(catalog.memes.length, 9);
  const media = await call(env, catalog.custom[0].image, {}, null);
  assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/jpeg'); assert.ok((await media.arrayBuffer()).byteLength > 1000);
  assert.equal((await call(env, '/api/settings', { method: 'PUT', body: JSON.stringify({ includeBuiltins: false }) })).status, 200);
  const ownOnly = await (await call(env, '/api/memes', {}, null)).json();
  assert.equal(ownOnly.memes.length, 3); assert.equal(ownOnly.includeBuiltins, false);
  let state = newGame(Math.random, ownOnly.memes);
  for (let i = 0; i < 9; i++) { assert.ok(ids.includes(state.challenge.target.id)); state = nextRound(answer(state, state.challenge.correctIndex)); }
  assert.equal(state.status, 'finished');
  assert.equal((await call(env, `/api/memes/${ids[0]}`, { method: 'DELETE' })).status, 200);
  const after = await (await call(env, '/api/memes', {}, null)).json();
  assert.equal(after.includeBuiltins, true); assert.equal(after.memes.length, 8);
  assert.equal((await call(env, `/media/${ids[0]}/audio`, {}, null)).status, 404);
});
test('Invalid uploads and cross-origin writes do not leave orphaned files', async () => {
  const env = { BUCKET: new MemoryBucket(), MEME_ADMIN_EMAIL: admin };
  assert.equal((await upload(env, 'SVG', admin, new TextEncoder().encode('<svg onload="alert(1)"/>'))).status, 400);
  assert.equal((await call(env, '/api/memes', { method: 'POST', headers: { Origin: 'https://other.example' }, body: 'x' })).status, 403);
  assert.equal((await call(env, '/api/settings', { method: 'PUT', body: JSON.stringify({ includeBuiltins: false }) })).status, 400);
  assert.equal(env.BUCKET.objects.size, 0);
});
test('Joystick clamps diagonals and preserves neutral and cardinal directions', () => {
  assert.deepEqual(joystickVector(0, 0), { x: 0, z: 0, px: 0, py: 0 });
  assert.equal(joystickVector(0, -42).z, -1);
  const diagonal = joystickVector(100, -100);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-9);
  assert.throws(() => newGame(Math.random, [{ id: 'one' }]));
});
