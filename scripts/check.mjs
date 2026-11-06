import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MEMES } from '../client/data.js';
for (const name of ['data.js', 'game.js', 'scene.js', 'app.js', 'library.js', 'joystick.js', 'characters.js', 'character-picker.js', 'preferences.js', 'account.js', 'level-editor.js', 'scoring.js', 'duels.js', 'multiplayer.js', 'player-session.js', 'player-profile.js']) {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../client/' + name, import.meta.url))]);
}
for (const meme of MEMES) {
  for (const asset of [meme.image, meme.audio]) await access(new URL('../client/' + asset, import.meta.url));
  if ((await readFile(new URL('../client/' + meme.audio, import.meta.url))).length < 1000) throw Error('Invalid audio: ' + meme.id);
}
await access(new URL('../client/vendor/three.module.js', import.meta.url));
console.log(`JavaScript and all ${MEMES.length * 2} meme assets: OK`);
