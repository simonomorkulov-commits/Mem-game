import test from 'node:test';
import assert from 'node:assert/strict';
import { readPreferences, savePreferences, normalizePreferences } from '../client/preferences.js';
import { move } from '../client/game.js';
import { joystickStrength } from '../client/joystick.js';

test('Small joystick movements have a neutral zone and proportional walking speed', () => {
  assert.equal(joystickStrength(.05, .05), 0);
  assert.equal(joystickStrength(0, 1), 1);
  const start = { x: 0, z: 0 };
  const full = move(start, { x: 0, z: -1 }, .04, joystickStrength(0, 1));
  const slow = move(start, { x: 0, z: -1 }, .04, joystickStrength(0, .57));
  assert.ok(Math.abs(slow.z - full.z / 2) < 1e-9);
  assert.deepEqual(move(start, { x: 0, z: -1 }, .04, 0), start);
});
test('Phone preferences survive a new session and recover from corrupt or unavailable storage', () => {
  let saved = null;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  savePreferences({ rightJoystick: true, powerSaving: true, vibration: false, muted: true, volume: .35 }, storage);
  assert.deepEqual(readPreferences(storage), { rightJoystick: true, powerSaving: true, vibration: false, muted: true, volume: .35 });
  saved = '{broken'; assert.equal(readPreferences(storage).volume, .65);
  assert.equal(readPreferences({ getItem() { throw Error('denied'); } }).rightJoystick, false);
  assert.equal(normalizePreferences({ volume: -20 }).volume, 0);
  assert.equal(normalizePreferences({ volume: 20 }).volume, 1);
});
