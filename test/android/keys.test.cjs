'use strict';

// Tests what the Android window does with each key pressed on this computer (src/windows/android/keys.js).
// keyAction() returns null for a character, which goes to the device as text; { send, meta } for an Android key code
// and its meta flags; or { local } for a key the computer keeps. The tests pass plain objects shaped like
// KeyboardEvents and name the computer's system, so every system's case runs anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const { keyAction } = require('../../src/windows/android/keys.js');

// A KeyboardEvent as the Android window passes it on: no modifier unless `modifiers` adds one, and altGraph as
// getModifierState('AltGraph') reports it.
const press = (key, code, modifiers = {}) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  isComposing: false,
  altGraph: false,
  ...modifiers,
});
const SYSTEMS = ['darwin', 'win32', 'linux'];
// Android's key codes (KeyEvent.KEYCODE_*) and meta flags (META_CTRL_ON, META_SHIFT_ON, META_META_ON).
const KEYCODE = {
  A: 29,
  C: 31,
  V: 50,
  W: 51,
  Z: 54,
  ENTER: 66,
  BACKSPACE: 67,
  TAB: 61,
  ESCAPE: 111,
  LEFT: 21,
  F5: 135,
};
const CTRL = 0x1000,
  SHIFT = 0x1,
  META = 0x10000;

test("characters arrive as text in the computer's own layout on every system", () => {
  for (const platform of SYSTEMS) {
    assert.equal(keyAction(press('a', 'KeyA'), { platform }), null);
    assert.equal(keyAction(press('A', 'KeyA', { shiftKey: true }), { platform }), null);
    assert.equal(keyAction(press('ñ', 'Semicolon'), { platform }), null); // the ñ key on a Spanish keyboard
    assert.equal(keyAction(press('Dead', 'Quote'), { platform }), null); // an accent waiting for its letter
    assert.equal(keyAction(press('á', 'KeyA', { isComposing: true }), { platform }), null);
    assert.equal(keyAction(press(' ', 'Space'), { platform }), null);
    assert.equal(keyAction(press('Shift', 'ShiftLeft', { shiftKey: true }), { platform }), null);
    assert.equal(keyAction(press('Control', 'ControlLeft', { ctrlKey: true }), { platform }), null);
  }
});

test('AltGr types characters on Windows and Linux instead of making shortcuts, and so does Option on a Mac', () => {
  assert.equal(
    keyAction(press('@', 'Digit2', { ctrlKey: true, altKey: true, altGraph: true }), {
      platform: 'win32',
    }),
    null,
  );
  assert.equal(
    keyAction(press('€', 'KeyE', { ctrlKey: true, altKey: true, altGraph: true }), {
      platform: 'win32',
    }),
    null,
  );
  assert.equal(keyAction(press('[', 'Quote', { altGraph: true }), { platform: 'linux' }), null);
  assert.equal(keyAction(press('™', 'Digit2', { altKey: true }), { platform: 'darwin' }), null);
});

test('Ctrl shortcuts reach the device on Windows and Linux, and ⌘ works as Ctrl on a Mac', () => {
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(keyAction(press('c', 'KeyC', { ctrlKey: true }), { platform }), {
      send: KEYCODE.C,
      meta: CTRL,
    });
    assert.deepEqual(
      keyAction(press('Z', 'KeyZ', { ctrlKey: true, shiftKey: true }), { platform }),
      { send: KEYCODE.Z, meta: CTRL | SHIFT },
    );
    assert.deepEqual(keyAction(press('w', 'KeyW', { ctrlKey: true }), { platform }), {
      send: KEYCODE.W,
      meta: CTRL,
    }); // a tab in the device's browser
    assert.deepEqual(keyAction(press('v', 'KeyV', { metaKey: true }), { platform }), {
      send: KEYCODE.V,
      meta: META,
    }); // the Windows key
  }
  assert.deepEqual(keyAction(press('c', 'KeyC', { metaKey: true }), { platform: 'darwin' }), {
    send: KEYCODE.C,
    meta: CTRL,
  });
  assert.deepEqual(keyAction(press('a', 'KeyA', { ctrlKey: true }), { platform: 'darwin' }), {
    send: KEYCODE.A,
    meta: CTRL,
  });
  // The letter on the key counts, as on a French keyboard with A where Q is, and the key's place where letters aren't Latin.
  assert.deepEqual(keyAction(press('a', 'KeyQ', { ctrlKey: true }), { platform: 'win32' }), {
    send: KEYCODE.A,
    meta: CTRL,
  });
  assert.deepEqual(keyAction(press('с', 'KeyC', { ctrlKey: true }), { platform: 'win32' }), {
    send: KEYCODE.C,
    meta: CTRL,
  });
});

test("keys that aren't characters reach the device with their modifiers on every system", () => {
  for (const platform of SYSTEMS) {
    assert.deepEqual(keyAction(press('Enter', 'Enter'), { platform }), {
      send: KEYCODE.ENTER,
      meta: 0,
    });
    assert.deepEqual(keyAction(press('Backspace', 'Backspace', { ctrlKey: true }), { platform }), {
      send: KEYCODE.BACKSPACE,
      meta: CTRL,
    });
    assert.deepEqual(keyAction(press('ArrowLeft', 'ArrowLeft', { shiftKey: true }), { platform }), {
      send: KEYCODE.LEFT,
      meta: SHIFT,
    });
    assert.deepEqual(keyAction(press('Escape', 'Escape'), { platform }), {
      send: KEYCODE.ESCAPE,
      meta: 0,
    });
    assert.deepEqual(keyAction(press('Tab', 'Tab', { shiftKey: true }), { platform }), {
      send: KEYCODE.TAB,
      meta: SHIFT,
    });
    assert.deepEqual(keyAction(press('F5', 'F5'), { platform }), { send: KEYCODE.F5, meta: 0 });
  }
  // The number pad's arrows without Num Lock, and its Enter.
  assert.deepEqual(keyAction(press('ArrowLeft', 'Numpad4'), { platform: 'win32' }), {
    send: KEYCODE.LEFT,
    meta: 0,
  });
  assert.deepEqual(keyAction(press('Enter', 'NumpadEnter'), { platform: 'win32' }), {
    send: KEYCODE.ENTER,
    meta: 0,
  });
});

test('the computer keeps its own window keys and full screen', () => {
  for (const code of ['KeyQ', 'KeyW', 'KeyH', 'KeyM']) {
    assert.deepEqual(
      keyAction(press(code[3].toLowerCase(), code, { metaKey: true }), { platform: 'darwin' }),
      { local: 'system' },
    );
  }
  assert.deepEqual(
    keyAction(press('f', 'KeyF', { ctrlKey: true, metaKey: true }), { platform: 'darwin' }),
    { local: 'fullscreen' },
  );
  assert.deepEqual(keyAction(press('F11', 'F11'), { platform: 'win32' }), { local: 'fullscreen' });
  assert.deepEqual(keyAction(press('F11', 'F11'), { platform: 'linux' }), { local: 'fullscreen' });
  for (const platform of SYSTEMS) {
    assert.deepEqual(keyAction(press('Escape', 'Escape'), { platform, fullscreen: true }), {
      local: 'exit-fullscreen',
    });
  }
});
