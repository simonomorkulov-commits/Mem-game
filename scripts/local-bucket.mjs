import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';

// A filesystem adapter for local development. Production uses the R2 binding.
export class LocalBucket {
  constructor(root) { this.root = root; }
  path(key, suffix = '') { return new URL(Buffer.from(key).toString('base64url') + suffix, this.root); }
  async put(key, value, options = {}) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(key), typeof value === 'string' ? value : Buffer.from(value));
    await writeFile(this.path(key, '.meta'), JSON.stringify(options.httpMetadata || {}));
  }
  async get(key) {
    try {
      const bytes = await readFile(this.path(key));
      let metadata = {}; try { metadata = JSON.parse(await readFile(this.path(key, '.meta'), 'utf8')); } catch {}
      return { body: bytes, httpMetadata: metadata, json: async () => JSON.parse(bytes.toString()) };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) for (const suffix of ['', '.meta']) {
      await unlink(this.path(key, suffix)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async list({ prefix = '' } = {}) {
    let files; try { files = await readdir(this.root); } catch (error) { if (error.code === 'ENOENT') files = []; else throw error; }
    return { objects: files.filter(f => !f.endsWith('.meta')).map(f => ({ key: Buffer.from(f, 'base64url').toString() })).filter(o => o.key.startsWith(prefix)), truncated: false };
  }
}
