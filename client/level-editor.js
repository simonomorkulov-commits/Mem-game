import { requestAPI } from './account.js';
import { getCatalog } from './library.js';
import { MEMES } from './data.js';
import { ROOM_THEMES } from './scoring.js';

const $ = id => document.getElementById(id);
export function initLevelEditor({ onOpen, onClose, onChange }) {
  let levels = [], memes = [], editing = null, newestMeme = null;
  const selects = [$('level-target'), $('level-other-a'), $('level-other-b')];
  function notice(text, error = false) { $('level-status').textContent = text; $('level-status').classList.toggle('is-error', error); }
  function preview() {
    const ids = selects.map(select => select.value);
    $('level-previews').replaceChildren();
    for (const [index, id] of ids.entries()) {
      const meme = memes.find(m => m.id === id); if (!meme) continue;
      const card = document.createElement('div'), image = document.createElement('img'), caption = document.createElement('small');
      image.src = meme.image; image.alt = meme.name; caption.textContent = index ? 'Отвлечение' : 'Правильный мем';
      card.append(image, caption); $('level-previews').append(card);
    }
    const target = memes.find(m => m.id === ids[0]); if (target && $('level-sound').getAttribute('src') !== target.audio) $('level-sound').src = target.audio;
  }
  function reset(targetId) {
    editing = null; $('level-form').reset();
    $('level-position').value = levels.length + 1; $('level-title').value = '';
    $('level-save').textContent = 'Добавить уровень'; $('level-delete').hidden = $('level-cancel').hidden = true;
    const target = memes.find(m => m.id === targetId) || memes[0];
    if (target) {
      selects[0].value = target.id;
      const others = memes.filter(m => m.id !== target.id); selects[1].value = others[0]?.id || ''; selects[2].value = others[1]?.id || '';
    }
    preview();
  }
  function edit(level) {
    editing = level.id; $('level-title').value = level.title; $('level-position').value = level.number;
    selects[0].value = level.targetId;
    const others = level.optionIds.filter(id => id !== level.targetId); selects[1].value = others[0]; selects[2].value = others[1];
    $('level-theme').value = level.theme; $('level-save').textContent = 'Сохранить уровень';
    $('level-delete').hidden = $('level-cancel').hidden = false; preview();
    $('level-dialog').scrollTo({ top: 0, behavior: 'smooth' }); notice(`Редактируешь уровень ${level.number}.`);
  }
  async function refresh() {
    const data = await requestAPI('/api/levels?manage=1'); levels = data.levels;
    $('level-count').textContent = levels.length;
    $('level-editor-content').hidden = !data.canManage; $('level-editor-guest').hidden = data.canManage;
    const list = $('level-list'); list.replaceChildren();
    for (const level of levels) {
      const card = document.createElement('article'); card.className = 'level-item';
      const number = document.createElement('span'); number.textContent = String(level.number).padStart(2, '0'); number.className = 'level-number';
      const image = document.createElement('img'); image.src = level.target?.image || ''; image.alt = level.target?.name || ''; image.loading = 'lazy';
      const text = document.createElement('div'), title = document.createElement('b'), description = document.createElement('small');
      title.textContent = level.title; description.textContent = (level.target?.name || ROOM_THEMES[level.theme]?.name) + (level.playable === false ? ' · встроенная подборка выключена' : '');
      text.append(title, description);
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = 'Изменить'; button.addEventListener('click', () => edit(level));
      card.append(number, image, text, button); list.append(card);
    }
    onChange(data);
  }
  async function open(targetId) {
    onOpen(); $('level-dialog').showModal(); notice('Открываем редактор уровней…');
    try {
      const catalog = await getCatalog(); memes = [...catalog.custom, ...MEMES];
      for (const select of selects) {
        select.replaceChildren();
        for (const meme of memes) { const option = document.createElement('option'); option.value = meme.id; option.textContent = meme.name + (meme.custom ? ' · мой' : ''); select.append(option); }
      }
      await refresh(); reset(targetId); notice('Выбери звук и три картинки. Правильный мем должен быть среди них.');
    } catch (error) { notice(error.message, true); }
  }
  $('level-builder-button').addEventListener('click', () => open());
  $('new-meme-level').addEventListener('click', () => open(newestMeme));
  $('level-close').addEventListener('click', () => $('level-dialog').close());
  $('level-dialog').addEventListener('close', () => { $('level-sound').pause(); onClose(); });
  for (const select of selects) select.addEventListener('change', () => {
    if (select === selects[0]) {
      const others = memes.filter(m => m.id !== select.value);
      if (selects[1].value === select.value) selects[1].value = others[0]?.id;
      if (selects[2].value === select.value || selects[2].value === selects[1].value) selects[2].value = others.find(m => m.id !== selects[1].value)?.id;
    }
    preview();
  });
  for (const [id, theme] of Object.entries(ROOM_THEMES)) { const option = document.createElement('option'); option.value = id; option.textContent = theme.name; $('level-theme').append(option); }
  $('level-form').addEventListener('submit', async event => {
    event.preventDefault(); const ids = selects.map(s => s.value); if (new Set(ids).size < 3) { notice('Нужны три разные картинки.', true); return; }
    $('level-save').disabled = true;
    try {
      await requestAPI(editing ? '/api/levels/' + editing : '/api/levels', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ title: $('level-title').value,
        position: Number($('level-position').value), targetId: ids[0], optionIds: ids, theme: $('level-theme').value }) });
      const wasEditing = !!editing; await refresh(); reset(); notice(wasEditing ? 'Уровень обновлён. Изменения появятся в новых партиях.' : 'Уровень добавлен в прохождение!');
    } catch (error) { notice(error.message, true); }
    finally { $('level-save').disabled = false; }
  });
  $('level-cancel').addEventListener('click', () => { reset(); notice('Можно добавить новый уровень.'); });
  $('level-delete').addEventListener('click', () => $('delete-level-dialog').showModal());
  $('level-delete-cancel').addEventListener('click', () => $('delete-level-dialog').close());
  $('level-delete-confirm').addEventListener('click', async () => {
    $('level-delete-confirm').disabled = true;
    try { await requestAPI('/api/levels/' + editing, { method: 'DELETE' }); $('delete-level-dialog').close(); await refresh(); reset(); notice('Уровень удалён из новых партий.'); }
    catch (error) { $('delete-level-dialog').close(); notice(error.message, true); }
    finally { $('level-delete-confirm').disabled = false; }
  });
  return { noteNewMeme(meme) { newestMeme = meme.id; $('new-meme-level').hidden = false; }, open };
}
