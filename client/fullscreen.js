export function initFullscreen() {
  let fallback = false, busy = false;
  const root = document.documentElement;
  const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const buttons = [...document.querySelectorAll('[data-fullscreen]')];
  function sync() {
    const active = !!nativeElement() || fallback;
    document.body.classList.toggle('game-fullscreen', active);
    for (const button of buttons) {
      const title = active ? 'Выйти из полного экрана' : 'Открыть на весь экран';
      button.setAttribute('aria-label', title); button.title = title; button.setAttribute('aria-pressed', String(active));
      if (button.id === 'fullscreen-button') button.textContent = title;
      else button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${active ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    window.dispatchEvent(new Event('resize'));
  }
  async function toggle() {
    if (busy) return; busy = true;
    try {
      if (nativeElement()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      } else if (fallback) fallback = false;
      else {
        const enter = root.requestFullscreen || root.webkitRequestFullscreen;
        if (enter) { try { await enter.call(root); } catch { fallback = true; } }
        else fallback = true;
      }
    } finally { busy = false; sync(); }
  }
  for (const button of buttons) { button.hidden = false; button.addEventListener('click', toggle); }
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fallback) { fallback = false; sync(); event.stopImmediatePropagation(); }
  }, true);
  sync();
}
