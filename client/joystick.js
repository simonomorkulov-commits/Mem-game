export function joystickVector(dx, dy, radius = 42) {
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? radius / length : 1;
  return { x: dx * scale / radius, z: dy * scale / radius, px: dx * scale, py: dy * scale };
}

export function joystickStrength(x, z) {
  return Math.max(0, Math.min(1, (Math.hypot(x, z) - .14) / .86));
}

export function bindJoystick(base, thumb, onMove) {
  let pointer = null;
  function update(event) {
    const rect = base.getBoundingClientRect();
    const radius = Math.max(12, (Math.min(rect.width, rect.height) - thumb.offsetWidth) / 2);
    const vector = joystickVector(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, radius);
    thumb.style.transform = `translate(${vector.px}px, ${vector.py}px)`;
    onMove(vector.x, vector.z);
  }
  function reset() { pointer = null; thumb.style.transform = ''; base.classList.remove('active'); onMove(0, 0); }
  base.addEventListener('pointerdown', event => {
    if (pointer !== null) return;
    event.preventDefault(); pointer = event.pointerId; base.setPointerCapture(pointer);
    base.classList.add('active'); update(event);
  });
  base.addEventListener('pointermove', event => { if (event.pointerId === pointer) { event.preventDefault(); update(event); } });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) base.addEventListener(name, event => { if (event.pointerId === pointer) reset(); });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  document.addEventListener('touchcancel', reset);
  window.addEventListener('resize', reset);
  return { reset };
}
