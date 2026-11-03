import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import worker from '../worker/index.js';
import { LocalBucket } from './local-bucket.mjs';
import { openLocalDB } from './local-db.mjs';

const root = path.resolve(fileURLToPath(new URL('../client/', import.meta.url)));
const bucket = new LocalBucket(new URL('../.local-data/', import.meta.url));
const database = openLocalDB();
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 13 * 1024 * 1024) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const headers = new Headers(req.headers);
      if (process.env.LOCAL_GUEST !== '1') { headers.set('oai-authenticated-user-email', process.env.LOCAL_USER_EMAIL || 'dev@local'); headers.set('oai-authenticated-user-id', process.env.LOCAL_USER_ID || 'local-owner'); }
      else { headers.delete('oai-authenticated-user-email'); headers.delete('oai-authenticated-user-id'); }
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await worker.fetch(request, { BUCKET: bucket, DB: database, MEME_ADMIN_EMAIL: 'dev@local' });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403); res.end(); return;
    }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
