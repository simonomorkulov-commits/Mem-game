import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { MEMES } from '../dist/data.js';
for (const name of ['data.js', 'game.js', 'scene.js', 'app.js']) {
  execFileSync(process.execPath, ['--check', new URL('../dist/' + name, import.meta.url).pathname.replace(/^\/(\w:)/, '$1')]);
}
for (const meme of MEMES) {
  for (const asset of [meme.image, meme.audio]) await access(new URL('../dist/' + asset, import.meta.url));
  if ((await readFile(new URL('../dist/' + meme.audio, import.meta.url))).length < 1000) throw Error('Invalid audio: ' + meme.id);
}
await access(new URL('../dist/vendor/three.module.js', import.meta.url));
console.log('JavaScript and all 12 meme assets: OK');
