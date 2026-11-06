import { requestAPI } from './account.js';
const $ = id => document.getElementById(id);
export function initBannerUI() {
  let busy = false, previewUrl;
  function render(data) {
    $('banner-admin').hidden = !data.canManage;
    const banner = data.banner, slot = $('sponsor-banner');
    slot.hidden = !banner;
    if (banner) {
      $('sponsor-image').src = banner.image; $('sponsor-image').alt = banner.title;
      slot.setAttribute('aria-label', banner.title + (banner.link ? ' — открыть сайт рекламодателя' : ''));
      if (banner.link) slot.href = banner.link; else slot.removeAttribute('href');
      $('banner-current').src = banner.image;
    } else { slot.removeAttribute('href'); $('sponsor-image').removeAttribute('src'); }
    $('banner-current').hidden = !banner; $('banner-remove').hidden = !banner;
    if (!busy) { $('banner-title').value = banner?.title || ''; $('banner-link').value = banner?.link || ''; }
  }
  async function refresh() {
    if (busy) return;
    try { render(await requestAPI('/api/banner')); }
    catch { $('banner-status').textContent = 'Не удалось загрузить баннер. Попробуй ещё раз.'; }
  }
  function message(text, error = false) { $('banner-status').textContent = text; $('banner-status').classList.toggle('is-error', error); }
  function lock(value) { busy = value; $('banner-save').disabled = $('banner-remove').disabled = value; }
  $('banner-file').addEventListener('change', () => {
    const file = $('banner-file').files[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { $('banner-file').value = ''; message('Картинка должна быть меньше 2 МБ.', true); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file); $('banner-current').src = previewUrl; $('banner-current').hidden = false;
    message('Предпросмотр. Нажми «Разместить баннер», чтобы его увидели игроки.');
  });
  $('banner-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const image = $('banner-file').files[0]; if (!image) { message('Выбери картинку баннера.', true); return; }
    lock(true);
    try {
      const form = new FormData(); form.set('image', image); form.set('title', $('banner-title').value || 'Реклама'); form.set('link', $('banner-link').value);
      const data = await requestAPI('/api/banner', { method: 'POST', body: form });
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      $('banner-file').value = ''; lock(false); render(data); message('Баннер размещён на игровом поле у всех игроков.');
    } catch (error) { message(error.message, true); }
    finally { lock(false); }
  });
  $('banner-remove').addEventListener('click', async () => {
    if (busy) return; lock(true);
    try { const data = await requestAPI('/api/banner', { method: 'DELETE' }); lock(false); render(data); message('Баннер убран.'); }
    catch (error) { message(error.message, true); }
    finally { lock(false); }
  });
  $('sponsor-banner').addEventListener('pointerdown', event => event.stopPropagation());
  refresh();
  setInterval(() => { if (!document.hidden && !$('library-dialog').open) refresh(); }, 30000);
  window.addEventListener('pageshow', refresh);
  return { refresh };
}
