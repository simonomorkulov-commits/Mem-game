import { authenticatedFetch } from './account.js';
const $ = id => document.getElementById(id);
const isPhone = () => navigator.maxTouchPoints > 0 || matchMedia('(max-width: 960px), (pointer: coarse)').matches;
export async function getCatalog() {
  const response = await authenticatedFetch('/api/memes', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Не удалось открыть коллекцию. Попробуй ещё раз.');
  return data;
}
async function api(url, options) {
  const response = await authenticatedFetch(url, options); const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Изменение не сохранилось. Попробуй ещё раз.');
  return data;
}
function message(text, error = false) {
  $('library-status').textContent = text; $('library-status').classList.toggle('is-error', error);
}
export function initLibrary({ onOpen, onClose, onMemeAdded }) {
  let catalog, imageBlob, audioFile, duration, previewImageUrl, previewAudioUrl, busy = false, deleting, playing;
  let preparing = 0;
  function syncUploadButton() {
    $('upload-button').disabled = busy || preparing > 0;
    $('upload-button').textContent = busy ? 'Сохраняем в коллекцию…' : preparing > 0 ? 'Готовим файлы…' : 'Добавить в игру +';
  }
  const dialog = $('library-dialog');
  function stopPreview() { playing?.pause(); playing = null; $('audio-preview').pause(); }
  function render() {
    $('library-count').textContent = catalog.custom.length;
    $('library-admin').hidden = !catalog.canManage; $('library-guest').hidden = catalog.canManage;
    $('include-builtins').checked = catalog.includeBuiltins;
    $('empty-library').hidden = catalog.custom.length > 0;
    $('empty-library').textContent = catalog.canManage ? 'Пока здесь пусто. Добавь первую пару «картинка + звук».' : 'Автор скоро добавит свои мемы. Пока можно играть со встроенными.';
    const list = $('custom-list'); list.replaceChildren();
    for (const meme of catalog.custom) {
      const card = document.createElement('article'); card.className = 'meme-item';
      const image = document.createElement('img'); image.src = meme.image; image.alt = meme.name; image.loading = 'lazy';
      const info = document.createElement('div'); const name = document.createElement('b'); name.textContent = meme.name;
      const small = document.createElement('small'); small.textContent = `${Number(meme.duration).toFixed(1)} сек. · В общей коллекции`;
      const listen = document.createElement('button'); listen.className = 'text-button'; listen.textContent = '▶ Слушать';
      listen.addEventListener('click', () => { stopPreview(); playing = new Audio(meme.audio); playing.volume = .65;
        playing.play().catch(() => message('Звук не загрузился. Попробуй ещё раз.', true)); });
      info.append(name, small, listen); card.append(image, info);
      if (catalog.canManage) {
        const remove = document.createElement('button'); remove.className = 'remove-meme'; remove.textContent = '×';
        remove.setAttribute('aria-label', `Удалить мем «${meme.name}»`);
        remove.addEventListener('click', () => { deleting = meme.id; $('delete-description').textContent = `«${meme.name}» исчезнет из общей коллекции на всех устройствах.`; $('delete-dialog').showModal(); });
        card.append(remove);
      }
      list.append(card);
    }
  }
  async function refresh() {
    message('Открываем общую коллекцию…');
    try { catalog = await getCatalog(); render(); message('Сохраняется для всех устройств и игроков.'); }
    catch (error) { message(error.message, true); }
  }
  async function open() { onOpen(); dialog.showModal(); document.body.classList.add('library-open'); await refresh(); }
  $('library-button').addEventListener('click', open);
  $('library-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { stopPreview(); document.body.classList.remove('library-open'); onClose(); });
  $('refresh-library').addEventListener('click', refresh);
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('confirm-delete').addEventListener('click', async () => {
    const button = $('confirm-delete'); button.disabled = true;
    try { await api(`/api/memes/${deleting}`, { method: 'DELETE' }); $('delete-dialog').close(); await refresh(); message('Мем удалён из общей коллекции.'); }
    catch (error) { $('delete-dialog').close(); message(error.message, true); }
    finally { button.disabled = false; }
  });
  $('include-builtins').addEventListener('change', async event => {
    const input = event.target; input.disabled = true;
    try { await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ includeBuiltins: input.checked }) });
      await refresh(); message(input.checked ? 'Твои и встроенные мемы участвуют в игре.' : 'Все игроки теперь играют только с твоими мемами.'); }
    catch (error) { input.checked = catalog.includeBuiltins; message(error.message, true); }
    finally { input.disabled = false; }
  });
  function previewVisibility() { $('upload-preview').hidden = !imageBlob && !audioFile; }
  $('meme-image').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    imageBlob = null; preparing++; syncUploadButton();
    try {
      if (file.size > 20 * 1024 * 1024) throw Error('Эта картинка больше 20 МБ. Выбери файл поменьше.');
      const url = URL.createObjectURL(file); const image = new Image();
      try { image.src = url; await image.decode(); } finally { URL.revokeObjectURL(url); }
      const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .85));
      if (!imageBlob || imageBlob.size > 4 * 1024 * 1024) throw Error('Не удалось подготовить картинку. Выбери JPG или PNG.');
      if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
      previewImageUrl = URL.createObjectURL(imageBlob); $('image-preview').src = previewImageUrl; $('image-preview').hidden = false;
      $('image-label').textContent = file.name; message(audioFile ? 'Картинка и звук готовы. Можно добавлять в игру.' : 'Картинка готова. Добавь её звук.');
    } catch (error) { event.target.value = ''; $('image-preview').hidden = true; message(error instanceof DOMException ? 'Не удалось прочитать картинку. Выбери JPG или PNG.' : error.message || 'Не удалось прочитать картинку.', true); }
    finally { preparing--; syncUploadButton(); previewVisibility(); }
  });
  $('meme-audio').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    audioFile = null; preparing++; syncUploadButton();
    let context;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error('Звук должен быть меньше 8 МБ.');
      context = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await context.decodeAudioData(await file.arrayBuffer()); duration = buffer.duration;
      if (!duration || duration > 20) throw Error('Выбери короткий фрагмент длиной до 20 секунд.');
      audioFile = file; if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
      previewAudioUrl = URL.createObjectURL(file); $('audio-preview').src = previewAudioUrl; $('audio-preview').hidden = false;
      $('audio-label').textContent = `${file.name} · ${duration.toFixed(1)} сек.`; message(imageBlob ? 'Картинка и звук готовы. Можно добавлять в игру.' : 'Звук готов. Теперь выбери картинку.');
    } catch (error) { event.target.value = ''; $('audio-preview').hidden = true; message(error instanceof DOMException ? 'Этот звук не читается. Попробуй MP3 или M4A.' : error.message || 'Этот звук не читается. Попробуй MP3.', true); }
    finally { await context?.close(); preparing--; syncUploadButton(); previewVisibility(); }
  });
  $('upload-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || preparing > 0) return;
    if (!imageBlob || !audioFile) { message('Сначала выбери и картинку, и звук.', true); return; }
    if (isPhone()) document.activeElement?.blur();
    busy = true; syncUploadButton(); stopPreview();
    try {
      const form = new FormData(); form.set('name', $('meme-name').value.trim()); form.set('image', imageBlob, 'image.webp');
      form.set('audio', audioFile, audioFile.name); form.set('duration', String(duration));
      const added = await api('/api/memes', { method: 'POST', body: form });
      onMemeAdded?.(added.meme);
      $('upload-form').reset(); imageBlob = audioFile = null;
      $('image-preview').hidden = $('audio-preview').hidden = true; $('audio-preview').removeAttribute('src');
      $('image-label').textContent = 'Выбрать картинку'; $('audio-label').textContent = 'Выбрать звук'; previewVisibility();
      if (previewImageUrl) URL.revokeObjectURL(previewImageUrl); if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
      await refresh(); message('Мем добавлен! Он уже доступен на всех устройствах и появится в новых партиях.');
      if (!isPhone()) $('meme-name').focus({ preventScroll: true });
      else $('library-status').scrollIntoView({ block: 'nearest' });
    } catch (error) { message(error.message, true); }
    finally { busy = false; syncUploadButton(); }
  });
  if (new URLSearchParams(location.search).has('collection')) { history.replaceState(null, '', location.pathname); open(); }
}
