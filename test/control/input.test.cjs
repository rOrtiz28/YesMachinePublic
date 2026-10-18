'use strict';

// Tests the controller that plays a viewer's keyboard and mouse on this computer (src/main/control/input.cjs), and
// the checks it makes on every message first. RobotJS and the clipboard are stand-ins that only record what they are
// asked, so no real key or click happens; the tests compare those calls. The platform is passed in, so the macOS and
// Windows cases run on any computer.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputController } = require('../../src/main/control/input.cjs');

/**
 * A controller for a 1920 × 1080 screen on Linux that allows every message, unless `options` says otherwise. Its
 * RobotJS and clipboard are stand-ins: every call is recorded in `calls` as [method, ...arguments], and
 * setClipboard() changes what the clipboard holds without being recorded.
 */
function fixture(options = {}) {
  const calls = [];
  let clipboardText = '';
  const robot = Object.fromEntries(
    [
      'moveMouse',
      'dragMouse',
      'mouseToggle',
      'mouseClick',
      'scrollMouse',
      'keyToggle',
      'typeString',
      'updateScreenMetrics',
    ].map((name) => [
      name,
      (...args) => {
        calls.push([name, ...args]);
      },
    ]),
  );
  const clipboard = {
    readText() {
      calls.push(['readText']);
      return clipboardText;
    },
    writeText(text) {
      calls.push(['writeText', text]);
      clipboardText = text;
    },
  };
  const controller = createInputController({
    robot,
    clipboard,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    platform: 'linux',
    allowed: () => true,
    ...options,
  });
  return {
    controller,
    calls,
    robot,
    clipboard,
    setClipboard: (value) => {
      clipboardText = value;
    },
  };
}

test('pointer coordinates include both edges without escaping selected screen bounds', () => {
  const { controller, calls } = fixture({
    bounds: { x: -1920, y: 100, width: 1920, height: 1080 },
  });
  controller.handle({ type: 'pointer', action: 'move', x: 0, y: 0 });
  controller.handle({ type: 'pointer', action: 'move', x: 1, y: 1 });
  controller.handle({ type: 'pointer', action: 'move', x: 0.5, y: 0.5 });
  assert.deepEqual(calls, [
    ['moveMouse', -1920, 100],
    ['moveMouse', -1, 1179],
    ['moveMouse', -960, 640],
  ]);
  controller.setBounds({ x: 50, y: 60, width: 1, height: 1 });
  controller.handle({ type: 'pointer', action: 'move', x: 1, y: 1 });
  assert.deepEqual(calls.at(-1), ['moveMouse', 50, 60]);
});

test('malformed input never reaches native methods', () => {
  const { controller, calls } = fixture();
  for (const message of [
    null,
    [],
    {},
    { type: 'missing' },
    { type: 'pointer', action: 'move', x: NaN, y: 0 },
    { type: 'pointer', action: 'move', x: Infinity, y: 0 },
    { type: 'pointer', action: 'move', x: '0.5', y: 0 },
    { type: 'pointer', action: 'move', x: -0.01, y: 0 },
    { type: 'pointer', action: 'move', x: 0, y: 1.01 },
    { type: 'pointer', action: 'click', x: 0, y: 0 },
    { type: 'pointer', action: 'down', x: 0, y: 0, button: 3 },
    { type: 'wheel', dx: NaN, dy: 0 },
    { type: 'wheel', dx: 0, dy: 10001 },
    { type: 'wheel', dx: '1', dy: 0 },
    { type: 'key', code: 'KeyA', down: 'down' },
    { type: 'key', code: {}, down: true },
    { type: 'key', code: 'KeyA', key: [], down: true },
    { type: 'text', text: {} },
    { type: 'text', text: 'a'.repeat(10001) },
    { type: 'text', text: 'a\0b' },
    { type: 'clipboard-set', text: 1 },
  ]) {
    assert.throws(() => controller.handle(message), { code: 'INVALID_INPUT' });
  }
  assert.deepEqual(calls, []);
});

test('screen bounds reject overflow and retain previous valid bounds after rejection', () => {
  const { controller, calls } = fixture();
  assert.throws(() => controller.setBounds({ x: 0, y: 0, width: 0, height: 10 }), {
    code: 'INVALID_INPUT',
  });
  assert.throws(() => controller.setBounds({ x: Infinity, y: 0, width: 20, height: 10 }), {
    code: 'INVALID_INPUT',
  });
  controller.handle({ type: 'pointer', action: 'move', x: 0, y: 0 });
  assert.deepEqual(calls, [['moveMouse', 0, 0]]);
});

test('button cleanup releases only session-owned buttons and macOS uses real drag events', () => {
  const { controller, calls } = fixture({ platform: 'darwin' });
  const pointer = { type: 'pointer', x: 0, y: 0, button: 0 };
  controller.handle({ ...pointer, action: 'up' });
  assert.deepEqual(calls, []);
  controller.handle({ ...pointer, action: 'down' });
  controller.handle({ ...pointer, action: 'move', x: 1 });
  controller.releaseAll();
  controller.releaseAll();
  assert.deepEqual(calls, [
    ['moveMouse', 0, 0],
    ['mouseToggle', 'down', 'left'],
    ['dragMouse', 1919, 0, 'left'],
    ['mouseToggle', 'up', 'left'],
  ]);
});

test('key identity uses physical code even if character case changes before release', () => {
  const { controller, calls } = fixture();
  controller.handle({ type: 'key', code: 'KeyA', key: 'A', down: true });
  controller.handle({ type: 'key', code: 'KeyA', key: 'a', down: false });
  controller.handle({ type: 'key', code: 'KeyB', down: false });
  controller.releaseAll();
  assert.deepEqual(calls, [
    ['keyToggle', 'a', 'down'],
    ['keyToggle', 'a', 'up'],
  ]);
});

test('unknown physical codes cannot smuggle native key strings or invoke secure-attention helpers', () => {
  const { controller, calls } = fixture();
  for (const message of [
    { code: 'Missing', key: 'a' },
    { key: 'control-alt-delete' },
    { code: 'constructor' },
    { key: '__proto__' },
    { key: 'a'.repeat(100) },
    { code: 'Power' },
  ])
    assert.throws(() => controller.handle({ type: 'key', down: true, ...message }));
  assert.deepEqual(calls, []);
});

test('macOS event flags follow held modifiers and both Meta keys share one native key', () => {
  const { controller, calls } = fixture({ platform: 'darwin' });
  for (const code of ['MetaLeft', 'MetaRight', 'ShiftLeft', 'KeyA'])
    controller.handle({ type: 'key', code, down: true });
  controller.handle({ type: 'key', code: 'KeyA', down: false });
  controller.handle({ type: 'key', code: 'MetaLeft', down: false });
  controller.handle({ type: 'key', code: 'MetaRight', down: false });
  controller.releaseAll();
  assert.deepEqual(calls, [
    ['keyToggle', 'command', 'down', ['command']],
    ['keyToggle', 'shift', 'down', ['command', 'shift']],
    ['keyToggle', 'a', 'down', ['command', 'shift']],
    ['keyToggle', 'a', 'up', ['command', 'shift']],
    ['keyToggle', 'command', 'up', ['shift']],
    ['keyToggle', 'shift', 'up', []],
  ]);
});

test('Windows Meta uses RobotJS command key and never toggles modifiers as implicit flags', () => {
  const { controller, calls } = fixture({ platform: 'win32' });
  controller.handle({ type: 'key', code: 'MetaLeft', down: true });
  controller.handle({ type: 'key', code: 'KeyE', down: true });
  controller.releaseAll();
  assert.deepEqual(calls, [
    ['keyToggle', 'command', 'down'],
    ['keyToggle', 'e', 'down'],
    ['keyToggle', 'e', 'up'],
    ['keyToggle', 'command', 'up'],
  ]);
});

test('every input including clipboard is checked, and denied input releases held controls', () => {
  let allowed = true;
  let checks = 0;
  const { controller, calls } = fixture({
    allowed: () => {
      checks++;
      return allowed;
    },
  });
  controller.handle({ type: 'key', code: 'ControlLeft', down: true });
  controller.handle({ type: 'pointer', action: 'down', x: 0, y: 0, button: 2 });
  allowed = false;
  for (const message of [
    { type: 'clipboard-get' },
    { type: 'clipboard-set', text: 'private' },
    { type: 'key', code: 'KeyA', down: true },
    { type: 'text', text: 'bad' },
  ]) {
    assert.throws(() => controller.handle(message), { code: 'INPUT_DENIED' });
  }
  assert.equal(checks, 6);
  assert.deepEqual(calls, [
    ['keyToggle', 'left_control', 'down'],
    ['moveMouse', 0, 0],
    ['mouseToggle', 'down', 'right'],
    ['keyToggle', 'left_control', 'up'],
    ['mouseToggle', 'up', 'right'],
  ]);
});

test('trusted disconnect cleanup works after permission is revoked', () => {
  let permitted = true;
  const { controller, calls } = fixture({ allowed: () => permitted });
  controller.handle({ type: 'key', code: 'ShiftLeft', down: true });
  permitted = false;
  assert.deepEqual(controller.releaseAll(), []);
  assert.deepEqual(calls.at(-1), ['keyToggle', 'shift', 'up']);
});

test('cleanup attempts all held controls and retries native releases that fail', () => {
  const errors = [];
  const { controller, robot, calls } = fixture({ onError: (error) => errors.push(error.message) });
  controller.handle({ type: 'key', code: 'KeyA', down: true });
  controller.handle({ type: 'key', code: 'KeyB', down: true });
  const original = robot.keyToggle;
  robot.keyToggle = (key, state) => {
    if (key === 'a' && state === 'up') throw new Error('native failure');
    original(key, state);
  };
  assert.equal(controller.releaseAll().length, 1);
  assert.deepEqual(calls.at(-1), ['keyToggle', 'b', 'up']);
  assert.deepEqual(errors, ['native failure']);
  robot.keyToggle = original;
  controller.releaseAll();
  assert.deepEqual(calls.at(-1), ['keyToggle', 'a', 'up']);
});

test('clipboard transfer preserves Unicode and enforces UTF-8 byte limits both directions', () => {
  const { controller, calls, setClipboard } = fixture();
  controller.handle({ type: 'clipboard-set', text: '¡Hola! 👋' });
  assert.deepEqual(controller.handle({ type: 'clipboard-get' }), {
    type: 'clipboard',
    text: '¡Hola! 👋',
  });
  assert.throws(() => controller.handle({ type: 'clipboard-set', text: 'é'.repeat(524289) }), {
    code: 'INVALID_INPUT',
  });
  setClipboard('a'.repeat(1048577));
  assert.throws(() => controller.handle({ type: 'clipboard-get' }), {
    code: 'CLIPBOARD_TOO_LARGE',
  });
  assert.equal(calls.filter((call) => call[0] === 'writeText').length, 1);
});

test('native unavailability is explicit while authorized clipboard stays usable', () => {
  const { controller } = fixture({ robot: null });
  assert.equal(controller.available, false);
  assert.throws(() => controller.handle({ type: 'key', code: 'KeyA', down: true }), {
    code: 'INPUT_UNAVAILABLE',
  });
  assert.deepEqual(controller.handle({ type: 'clipboard-get' }), { type: 'clipboard', text: '' });
  const closed = createInputController();
  assert.throws(() => closed.handle({ type: 'clipboard-get' }), { code: 'INPUT_DENIED' });
});

test('wheel input reverses browser direction and bounds expensive X11 event loops', () => {
  const { controller, calls } = fixture();
  controller.handle({ type: 'wheel', dx: 80, dy: -120 });
  controller.handle({ type: 'wheel', dx: 10000, dy: -10000 });
  controller.handle({ type: 'wheel', dx: 0, dy: 0 });
  assert.deepEqual(calls, [
    ['scrollMouse', -2, 3],
    ['scrollMouse', -25, 25],
  ]);
  const mac = fixture({ platform: 'darwin' });
  mac.controller.handle({ type: 'wheel', dx: 12.4, dy: -30.1 });
  assert.deepEqual(mac.calls, [['scrollMouse', -12, 30]]);
});

test('typing clears held shortcuts and unsupported native Unicode is explicit', () => {
  const { controller, calls } = fixture();
  controller.handle({ type: 'key', code: 'ControlLeft', down: true });
  controller.handle({ type: 'text', text: 'hello' });
  assert.deepEqual(calls, [
    ['keyToggle', 'left_control', 'down'],
    ['keyToggle', 'left_control', 'up'],
    ['typeString', 'hello'],
  ]);
  assert.throws(() => controller.handle({ type: 'text', text: 'ñ' }), { code: 'UNSUPPORTED_TEXT' });
  const mac = fixture({ platform: 'darwin' });
  mac.controller.handle({ type: 'text', text: '¡Hola! 👋' });
  assert.deepEqual(mac.calls, [['typeString', '¡Hola! 👋']]);
});

test('native double-click uses normalized position and rejects malformed, modified, or unauthorized input', () => {
  let permitted = true;
  const { controller, calls } = fixture({ platform: 'darwin', allowed: () => permitted });
  const click = { type: 'double-click', x: 1, y: 0, button: 0 };
  controller.handle(click);
  assert.deepEqual(calls, [
    ['moveMouse', 1919, 0],
    ['mouseClick', 'left', true],
  ]);
  assert.throws(() => controller.handle({ ...click, x: NaN }), { code: 'INVALID_INPUT' });
  assert.throws(() => controller.handle({ ...click, button: 3 }), { code: 'INVALID_INPUT' });
  controller.handle({ type: 'key', code: 'ControlLeft', down: true });
  assert.throws(() => controller.handle(click), { code: 'INPUT_BUSY' });
  controller.releaseAll();
  permitted = false;
  assert.throws(() => controller.handle(click), { code: 'INPUT_DENIED' });
  assert.equal(calls.filter((call) => call[0] === 'mouseClick').length, 1);
});
