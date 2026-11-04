import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { MEMES } from '../client/data.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };
const assets = {};
async function walk(dir = '') {
  for (const entry of await readdir(new URL('client/' + dir, root), { withFileTypes: true })) {
    const file = dir + entry.name;
    if (entry.isDirectory()) await walk(file + '/');
    else {
      const extension = '.' + file.split('.').pop(); const binary = ['.mp3', '.jpg', '.png'].includes(extension);
      const bytes = await readFile(new URL('client/' + file, root));
      assets['/' + file] = { content: bytes.toString(binary ? 'base64' : 'utf8'), binary, type: types[extension] || 'application/octet-stream' };
    }
  }
}
await walk();
const modules = [];
for (const file of ['client/scoring.js', 'worker/account-api.js', 'worker/duel-api.js', 'worker/match-api.js', 'worker/game-api.js', 'worker/index.js']) {
  modules.push((await readFile(new URL(file, root), 'utf8')).replace(/^import .*;\r?$/gm, '').replace(/^export (?!default)/gm, ''));
}
let worker = `const BUILTIN_MEMES = ${JSON.stringify(MEMES)};\n` + modules.join('\n');
worker = worker.replace('const ASSETS = {};', () => `const ASSETS = ${JSON.stringify(assets)};`);
await mkdir(new URL('dist/server/', root), { recursive: true });
await mkdir(new URL('dist/.openai/', root), { recursive: true });
await writeFile(new URL('dist/server/index.js', root), worker);
execFileSync(process.execPath, ['--check', fileURLToPath(new URL('dist/server/index.js', root))]);
await copyFile(new URL('.openai/hosting.json', root), new URL('dist/.openai/hosting.json', root));
console.log(`Worker built: ${Object.keys(assets).length} embedded assets, shared R2 collection`);
