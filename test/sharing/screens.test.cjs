'use strict';

// Tests the list of screens a computer can share, and the choice among them (src/main/sharing/screens.cjs). The
// displays are plain objects shaped like Electron's; Electron doesn't run.

const test = require('node:test');
const assert = require('node:assert/strict');
const { listScreens, chooseScreen } = require('../../src/main/sharing/screens.cjs');

// A display as Electron's screen.getAllDisplays() describes it: its id, its place and size in points, its scale
// factor and its name.
const display = (id, x, y, width, height, scaleFactor = 1, label = '') => ({
  id,
  label,
  scaleFactor,
  bounds: { x, y, width, height },
});

test('screens come in the order the computer places them, with their size in pixels and the main one marked', () => {
  const screens = listScreens(
    [
      display(7, 1512, -200, 2560, 1440, 1, 'LG UltraFine'),
      display(1, 0, 0, 1512, 982, 2, 'Built-in Retina Display'),
    ],
    1,
  );
  assert.deepEqual(
    screens.map((item) => [item.id, item.name, item.width, item.height, item.main]),
    [
      ['1', 'Built-in Retina Display', 3024, 1964, true],
      ['7', 'LG UltraFine', 2560, 1440, false],
    ],
  );
  assert.deepEqual(screens[1], {
    id: '7',
    name: 'LG UltraFine',
    width: 2560,
    height: 1440,
    x: 1512,
    y: -200,
    w: 2560,
    h: 1440,
    main: false,
  });
});

test('a screen without a name gets its number, and names lose control characters', () => {
  const screens = listScreens(
    [display(2, 1920, 0, 1920, 1080), display(1, 0, 0, 1920, 1080, 1, 'Dell\u0000 U2720Q\n')],
    1,
  );
  assert.deepEqual(
    screens.map((item) => item.name),
    ['Dell U2720Q', 'Screen 2'],
  );
});

test('a long name is cut to 60 characters, never through an emoji', () => {
  // 📺 is two UTF-16 units; at 59 and 60 the cut would split it.
  const [screen] = listScreens([display(1, 0, 0, 1920, 1080, 1, 'x'.repeat(59) + '📺')], 1);
  assert.equal(screen.name, 'x'.repeat(59));
});

test('broken entries are left out', () => {
  assert.deepEqual(listScreens(null, 1), []);
  assert.deepEqual(listScreens([null, { id: 3 }, display(4, 0, 0, 0, 100)], 4), []);
});

test('the chosen screen is shared while it is connected, then the main one', () => {
  const screens = listScreens([display(1, 0, 0, 1512, 982, 2), display(7, 1512, 0, 2560, 1440)], 1);
  assert.equal(chooseScreen(screens, '7').id, '7');
  assert.equal(chooseScreen(screens, 7).id, '7');
  assert.equal(chooseScreen(screens, '9').id, '1'); // unplugged
  assert.equal(chooseScreen(screens, null).id, '1');
  assert.equal(chooseScreen(listScreens([display(5, 0, 0, 800, 600)], 1), null).id, '5'); // no main among them
  assert.equal(chooseScreen([], '1'), null);
});
