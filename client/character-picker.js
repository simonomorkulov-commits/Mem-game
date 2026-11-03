import { CHARACTERS, characterInfo, renderCharacterPreviews } from './characters.js';

const key = 'igra-memov:character:v1';
export function selectedCharacter() {
  try { return characterInfo(localStorage.getItem(key)).id; } catch { return CHARACTERS[0].id; }
}

export function initCharacterPicker({ onOpen, onClose, onSelect }) {
  const dialog = document.getElementById('character-dialog');
  const apply = document.getElementById('character-apply');
  const label = document.getElementById('selected-character-name');
  const portrait = document.getElementById('selected-character-portrait');
  const cards = [...document.querySelectorAll('[data-character]')];
  const images = Object.fromEntries(CHARACTERS.map(info => [info.id, document.getElementById('portrait-' + info.id)]));
  let selected = selectedCharacter(), draft = selected, previewsReady = false;
  function sync() {
    label.textContent = characterInfo(selected).name;
    for (const card of cards) card.setAttribute('aria-pressed', String(card.dataset.character === draft));
    apply.textContent = 'Выбрать: ' + characterInfo(draft).name;
    if (images[selected].getAttribute('src')) portrait.src = images[selected].src;
  }
  function open() {
    draft = selected; sync(); onOpen(); dialog.showModal();
    if (!previewsReady) {
      try { renderCharacterPreviews(images); previewsReady = true; sync(); }
      catch (error) { console.error('Character previews:', error); }
    }
    cards.find(card => card.dataset.character === draft)?.focus({ preventScroll: true });
  }
  for (const id of ['character-button', 'pause-character-button']) document.getElementById(id).addEventListener('click', open);
  for (const card of cards) card.addEventListener('click', () => { draft = card.dataset.character; sync(); });
  apply.addEventListener('click', () => {
    selected = draft;
    try { localStorage.setItem(key, selected); } catch { /* Selection also works without browser storage. */ }
    onSelect(selected); sync(); dialog.close();
  });
  document.getElementById('character-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', onClose);
  sync();
  return { preparePreviews() {
    try { renderCharacterPreviews(images); previewsReady = true; sync(); } catch (error) { console.error('Character previews:', error); }
  } };
}
