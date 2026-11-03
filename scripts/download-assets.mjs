import { mkdir, writeFile } from 'node:fs/promises';

const base = new URL('../client/', import.meta.url);
await mkdir(new URL('assets/', base), { recursive: true });
await mkdir(new URL('vendor/', base), { recursive: true });
const soundBase = 'https://raw.githubusercontent.com/PareekshithPalat/IDE-Error-Soundboard/main/sounds/';
const files = [
  ['vendor/three.module.js', 'https://raw.githubusercontent.com/mrdoob/three.js/r170/build/three.module.js'],
  ['vendor/THREE-LICENSE.txt', 'https://raw.githubusercontent.com/mrdoob/three.js/r170/LICENSE'],
  ['assets/bruh.mp3', soundBase + 'bruh.mp3'],
  ['assets/vine-boom.mp3', soundBase + 'vine-boom.mp3'],
  ['assets/among-us.mp3', soundBase + 'among-us-role.mp3'],
  ['assets/metal-pipe.mp3', soundBase + 'metal-pipe-clang.mp3'],
  ['assets/anime-wow.mp3', soundBase + 'anime-wow.mp3'],
  ['assets/spongebob.mp3', soundBase + 'spongebob-fail.mp3'],
  ['assets/rock.jpg', 'https://images.meme-arsenal.com/d0e5e24e4ab1fc3ac9be46a5f6ae5ad8.jpg'],
  ['assets/spongebob.jpg', 'https://i.imgflip.com/1otk96.jpg']
];
for (const [file, url] of files) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${response.status}: ${file}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 500) throw Error(`Asset is too small: ${file}`);
  await writeFile(new URL(file, base), bytes);
  console.log(`${file}: ${bytes.length} bytes`);
}

function svg(background, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="720" viewBox="0 0 640 720"><defs><radialGradient id="bg"><stop stop-color="${background}"/><stop offset="1" stop-color="#161328"/></radialGradient><linearGradient id="metal" x2=".8" y2="1"><stop stop-color="#eefaff"/><stop offset=".35" stop-color="#a4b5c4"/><stop offset=".48" stop-color="#f2faff"/><stop offset=".6" stop-color="#59637f"/><stop offset="1" stop-color="#c9dce8"/></linearGradient></defs><rect width="640" height="720" fill="url(#bg)"/><circle cx="320" cy="330" r="244" fill="white" opacity=".04"/>${content}</svg>`;
}
const art = {
  'among-us': svg('#713056', '<ellipse cx="328" cy="614" rx="180" ry="28" fill="#0c0b16" opacity=".5"/><g stroke="#1b1023" stroke-width="17" stroke-linejoin="round"><rect x="419" y="280" width="80" height="220" rx="32" fill="#991d50"/><path d="M187 566V289C187 116 443 117 443 289V566Q443 602 383 602V501H300V602Q187 621 187 566Z" fill="#f45583"/><path d="M208 293C208 186 336 168 382 213" fill="none" stroke="#ff9db7" stroke-width="28" stroke-linecap="round"/><rect x="240" y="255" width="218" height="139" rx="66" fill="#8de8ef"/><path d="M265 319Q283 274 390 277" fill="none" stroke="#e9ffff" stroke-width="25" stroke-linecap="round"/></g><path d="m99 119 18 32 36 5-26 25 6 36-33-17-33 17 7-36-26-25 36-5Z" fill="#ffcc6f"/>'),
  'metal-pipe': svg('#34485f', '<ellipse cx="320" cy="601" rx="188" ry="24" fill="#0c0b16" opacity=".6"/><g transform="rotate(24 320 350)"><path d="M254 151H386V554Q320 590 254 554Z" fill="url(#metal)" stroke="#1b2039" stroke-width="9"/><ellipse cx="320" cy="151" rx="66" ry="25" fill="#d4e3f0" stroke="#1b2039" stroke-width="9"/><ellipse cx="320" cy="151" rx="43" ry="13" fill="#2e3446"/></g><g fill="none" stroke="#b8ebff" stroke-width="11" stroke-linecap="round"><path d="m117 253-26-35m438 40 26-35m-57 335 35 19M139 545l-32 21M167 185l-12-39"/></g><path d="m345 619 17-48 23 33 49-8-26 39 23 42-48-12-34 31Z" fill="#d6fc91"/>'),
  'bruh': svg('#68734a', '<ellipse cx="325" cy="614" rx="192" ry="26" fill="#11141c" opacity=".4"/><path d="M157 713V581Q310 484 466 581V713" fill="#b8ff65" stroke="#161722" stroke-width="13"/><path d="M168 307C168 97 488 103 484 328L466 453Q440 556 321 564Q190 550 174 450Z" fill="#f1e9d9" stroke="#161722" stroke-width="13"/><path d="M168 314Q136 84 323 105Q502 89 486 298L438 234 408 243 385 209 345 228 303 197 261 234 208 226Z" fill="#242330" stroke="#161722" stroke-width="12"/><g fill="none" stroke="#22212d" stroke-linecap="round"><path d="m218 327 72-8m69 1 70 10" stroke-width="16"/><path d="M218 365h68m75 0h63" stroke-width="8"/><path d="M272 468h103" stroke-width="13"/><path d="m322 372-12 43h25" stroke-width="8"/></g><path d="M221 383v28m199-28v28" stroke="#d7a897" stroke-width="13" stroke-linecap="round"/>'),
  'anime-wow': svg('#734465', '<path d="m80 157 47 71 85-7-52 67 32 80-79-29-67 54 3-85-72-44 82-23Z" fill="#ffe1a2" opacity=".8"/><path d="M115 655V310C93 89 554 76 531 310V655" fill="#c5a2ff" stroke="#2e2447" stroke-width="12"/><path d="M170 345Q165 167 321 168Q486 160 478 345L460 458Q432 548 322 552Q211 549 181 462Z" fill="#ffe8df" stroke="#2e2447" stroke-width="10"/><path d="M162 347Q153 139 330 147Q510 154 484 350L431 264 394 307 358 245 301 291 271 245 208 312Z" fill="#b38ae8" stroke="#2e2447" stroke-width="10"/><ellipse cx="249" cy="386" rx="43" ry="59" fill="#502b70"/><ellipse cx="396" cy="386" rx="43" ry="59" fill="#502b70"/><g fill="#fff3af"><path d="m249 338 10 33 30 12-30 12-10 34-10-34-30-12 30-12Z"/><path d="m396 338 10 33 30 12-30 12-10 34-10-34-30-12 30-12Z"/></g><ellipse cx="324" cy="469" rx="23" ry="29" fill="#a44d75"/><path d="M160 720V611Q322 520 484 611V720" fill="#ffc3df" stroke="#2e2447" stroke-width="12"/><path d="m279 577 45 58 42-58" fill="#fff4e9" stroke="#2e2447" stroke-width="9"/><path d="m475 115 12 35 36 7-29 23 4 37-30-21-34 15 10-35-23-29 37-1Z" fill="#fff2ad"/>')
};
for (const [id, content] of Object.entries(art)) await writeFile(new URL(`assets/${id}.svg`, base), content);
await writeFile(new URL('assets/favicon.svg', base), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="17" fill="#b8ff65"/><path d="M14 47V18h8l10 14 10-14h8v29H39V34l-7 10-7-10v13Z" fill="#15151c"/></svg>');
console.log('Original portal illustrations: OK');
