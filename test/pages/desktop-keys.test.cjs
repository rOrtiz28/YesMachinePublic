'use strict';

// Tests the browser viewer's keyboard translation (public/keys.js), which decides what the viewer sends to the
// computer for each key and click. Keys go as pressed, except when a Mac (or an iPad) controls Windows or Linux:
// then the Mac's shortcuts are turned into what does the same thing there. The tests drive the real translator with
// plain objects shaped like KeyboardEvents and compare the { key, code, down } messages it returns. A down() that
// returns null means the Mac keeps that key for itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeyboard } = require('../../public/keys.js');

// A KeyboardEvent as the browser reports it: a modifier's own keydown already has its flag, its keyup no longer does.
const press = (key, code, modifiers = {}) => ({
  key,
  code,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
});
// The Mac's ⌘ and ⌥ keys going down and coming back up.
const COMMAND = press('Meta', 'MetaLeft', { metaKey: true }),
  COMMAND_UP = press('Meta', 'MetaLeft');
const OPTION = press('Alt', 'AltLeft', { altKey: true }),
  OPTION_UP = press('Alt', 'AltLeft');
// The messages a test expects, as [code, down] pairs, and the messages the keyboard returned, in the same form.
const keys = (...pairs) => pairs.map(([code, down]) => [code, down]);
const sent = (messages) => messages.map(({ code, down }) => [code, down]);
/** A keyboard on a Mac that controls a computer whose platform (as Node names it) is `host`. */
function macOn(host) {
  const keyboard = createKeyboard({ mac: true });
  keyboard.setHost(host);
  return keyboard;
}

test('keys go as pressed between two Macs, between PCs, and before the computer says what it is', () => {
  for (const [mac, host] of [
    [true, 'darwin'],
    [false, 'win32'],
    [false, 'linux'],
    [false, 'darwin'],
    [true, ''],
  ]) {
    const keyboard = createKeyboard({ mac });
    keyboard.setHost(host);
    assert.deepEqual(keyboard.down(COMMAND), [{ key: 'Meta', code: 'MetaLeft', down: true }]);
    assert.deepEqual(
      sent(keyboard.down(press('c', 'KeyC', { metaKey: true }))),
      keys(['KeyC', true]),
    );
    assert.deepEqual(
      sent(keyboard.up(press('c', 'KeyC', { metaKey: true }))),
      keys(['KeyC', false]),
    );
    assert.deepEqual(sent(keyboard.up(COMMAND_UP)), keys(['MetaLeft', false]));
    assert.deepEqual(
      sent(keyboard.down(press('ArrowLeft', 'ArrowLeft', { altKey: true }))),
      keys(['ArrowLeft', true]),
    );
    assert.deepEqual(keyboard.pointer(press('', '', { metaKey: true })), []);
  }
});

for (const host of ['win32', 'linux']) {
  test(`on ${host}, ⌘ from a Mac works as Ctrl and reaches the computer only with its key`, () => {
    const keyboard = macOn(host);
    assert.deepEqual(keyboard.down(COMMAND), []);
    assert.deepEqual(keyboard.down(press('c', 'KeyC', { metaKey: true })), [
      { key: 'Control', code: 'ControlLeft', down: true },
      { key: 'c', code: 'KeyC', down: true },
    ]);
    assert.deepEqual(
      sent(keyboard.up(press('c', 'KeyC', { metaKey: true }))),
      keys(['KeyC', false]),
    );
    assert.deepEqual(
      sent(keyboard.down(press('v', 'KeyV', { metaKey: true }))),
      keys(['KeyV', true]),
    ); // Ctrl is still held
    assert.deepEqual(
      sent(keyboard.up(press('v', 'KeyV', { metaKey: true }))),
      keys(['KeyV', false]),
    );
    assert.deepEqual(sent(keyboard.up(COMMAND_UP)), keys(['ControlLeft', false]));
    // ⌘ alone sends nothing: the Windows key is the drawer's button.
    assert.deepEqual(keyboard.down(COMMAND), []);
    assert.deepEqual(keyboard.up(COMMAND_UP), []);
  });

  test(`on ${host}, a Mac's text shortcuts do what they do on a Mac`, () => {
    const keyboard = macOn(host);
    const shortcut = (key, code, modifiers) => {
      const down = sent(keyboard.down(press(key, code, modifiers)));
      const up = sent(keyboard.up(press(key, code, modifiers)));
      return [down, up];
    };
    keyboard.down(COMMAND);
    assert.deepEqual(shortcut('ArrowLeft', 'ArrowLeft', { metaKey: true }), [
      keys(['Home', true]),
      keys(['Home', false]),
    ]);
    assert.deepEqual(shortcut('ArrowRight', 'ArrowRight', { metaKey: true }), [
      keys(['End', true]),
      keys(['End', false]),
    ]);
    assert.deepEqual(shortcut('ArrowUp', 'ArrowUp', { metaKey: true }), [
      keys(['ControlLeft', true], ['Home', true]),
      keys(['Home', false]),
    ]);
    // From ⌘↑ to ⌘→ Ctrl comes off first, so the cursor goes to the end of the line and not a word along.
    assert.deepEqual(shortcut('ArrowRight', 'ArrowRight', { metaKey: true }), [
      keys(['ControlLeft', false], ['End', true]),
      keys(['End', false]),
    ]);
    assert.deepEqual(keyboard.up(COMMAND_UP), []);
    keyboard.down(press('Shift', 'ShiftLeft', { shiftKey: true }));
    keyboard.down(press('Meta', 'MetaLeft', { metaKey: true, shiftKey: true }));
    assert.deepEqual(
      shortcut('ArrowLeft', 'ArrowLeft', { metaKey: true, shiftKey: true })[0],
      keys(['Home', true]),
    ); // selects to the line's start
    keyboard.up(press('Meta', 'MetaLeft', { shiftKey: true }));
    assert.deepEqual(sent(keyboard.up(press('Shift', 'ShiftLeft'))), keys(['ShiftLeft', false]));
    // ⌥ moves and deletes by word, as Ctrl does there, and never sends Alt+← (Back in a browser).
    assert.deepEqual(keyboard.down(OPTION), []);
    assert.deepEqual(shortcut('ArrowLeft', 'ArrowLeft', { altKey: true }), [
      keys(['ControlLeft', true], ['ArrowLeft', true]),
      keys(['ArrowLeft', false]),
    ]);
    assert.deepEqual(
      shortcut('Backspace', 'Backspace', { altKey: true })[0],
      keys(['Backspace', true]),
    );
    assert.deepEqual(sent(keyboard.up(OPTION_UP)), keys(['ControlLeft', false]));
  });

  test(`on ${host}, ⌥ with other keys is Alt, and the Mac's Control and Shift stay themselves`, () => {
    const keyboard = macOn(host);
    keyboard.down(OPTION);
    assert.deepEqual(
      sent(keyboard.down(press('≈', 'KeyX', { altKey: true }))),
      keys(['AltLeft', true], ['KeyX', true]),
    );
    keyboard.up(press('≈', 'KeyX', { altKey: true }));
    assert.deepEqual(sent(keyboard.up(OPTION_UP)), keys(['AltLeft', false]));
    assert.deepEqual(
      sent(keyboard.down(press('Control', 'ControlLeft', { ctrlKey: true }))),
      keys(['ControlLeft', true]),
    );
    assert.deepEqual(
      sent(keyboard.down(press('c', 'KeyC', { ctrlKey: true }))),
      keys(['KeyC', true]),
    );
    keyboard.up(press('c', 'KeyC', { ctrlKey: true }));
    assert.deepEqual(
      sent(keyboard.up(press('Control', 'ControlLeft'))),
      keys(['ControlLeft', false]),
    );
    assert.deepEqual(
      sent(keyboard.down(press('Shift', 'ShiftLeft', { shiftKey: true }))),
      keys(['ShiftLeft', true]),
    );
    assert.deepEqual(
      sent(keyboard.down(press('A', 'KeyA', { shiftKey: true }))),
      keys(['KeyA', true]),
    );
  });

  test(`on ${host}, ⌘Q, ⌘W, ⌘H and ⌘M stay with the Mac`, () => {
    const keyboard = macOn(host);
    keyboard.down(COMMAND);
    for (const code of ['KeyQ', 'KeyW', 'KeyH', 'KeyM', 'Backquote', 'Comma']) {
      assert.equal(keyboard.down(press('x', code, { metaKey: true })), null, code);
      assert.deepEqual(keyboard.up(press('x', code, { metaKey: true })), [], code);
    }
    assert.deepEqual(
      sent(keyboard.down(press('w', 'KeyW', { ctrlKey: true }))),
      keys(['ControlLeft', true], ['KeyW', true]),
    ); // ⌃W goes
  });

  test(`on ${host}, ⌘-click arrives as Ctrl-click and ⌥-click as Alt-click`, () => {
    const keyboard = macOn(host);
    keyboard.down(COMMAND);
    assert.deepEqual(
      sent(keyboard.pointer(press('', '', { metaKey: true }))),
      keys(['ControlLeft', true]),
    );
    assert.deepEqual(sent(keyboard.up(COMMAND_UP)), keys(['ControlLeft', false]));
    keyboard.down(OPTION);
    assert.deepEqual(
      sent(keyboard.pointer(press('', '', { altKey: true }))),
      keys(['AltLeft', true]),
    );
    assert.deepEqual(sent(keyboard.pointer(press('', ''))), keys(['AltLeft', false])); // a plain click lets go of it
  });
}

test('the same computer reporting again keeps what is held; another one starts afresh', () => {
  const keyboard = macOn('win32');
  keyboard.down(COMMAND);
  keyboard.down(press('c', 'KeyC', { metaKey: true }));
  keyboard.setHost('win32');
  assert.deepEqual(sent(keyboard.up(press('c', 'KeyC', { metaKey: true }))), keys(['KeyC', false]));
  keyboard.down(press('c', 'KeyC', { metaKey: true }));
  keyboard.setHost('darwin');
  assert.deepEqual(keyboard.up(press('c', 'KeyC', { metaKey: true })), []);
  keyboard.release();
  assert.deepEqual(sent(keyboard.down(COMMAND)), keys(['MetaLeft', true]));
});
