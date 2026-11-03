export const DEFAULT_PREFERENCES = Object.freeze({ rightJoystick: false,
  powerSaving: false, vibration: true, volume: .65, muted: false });
const key = 'igra-memov:preferences:v1';
export function normalizePreferences(value) {
  const input = value && typeof value === 'object' ? value : {};
  return { rightJoystick: input.rightJoystick === true, powerSaving: input.powerSaving === true,
    vibration: input.vibration !== false, muted: input.muted === true,
    volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(1, input.volume)) : .65 };
}
export function readPreferences(storage) {
  try { return normalizePreferences(JSON.parse((storage || globalThis.localStorage).getItem(key))); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}
export function savePreferences(value, storage) {
  try { (storage || globalThis.localStorage).setItem(key, JSON.stringify(normalizePreferences(value))); } catch {}
}
