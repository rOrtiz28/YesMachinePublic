'use strict';

// Tests the viewers' colors and their night and day support by reading the source; no browser runs. Both viewers
// (the browser viewer public/client.html and the Android window src/windows/android/viewer.html) load
// public/style.css, whose color tokens must match those of the main window (src/windows/host/host.css). The two
// style sheets switch to day colors differently: the main window under :root[data-theme='light'], the viewers under
// @media (prefers-color-scheme: light), so the test compares the custom properties of those blocks.

const test = require('node:test');
const assert = require('node:assert/strict');
const { read, element, buttons, text, customProperties } = require('../helpers/markup.cjs');

test('the viewers use the main window’s colors, night and day, and every color has a day value', () => {
  const host = read('src/windows/host/host.css'),
    viewer = read('public/style.css');
  const hostNight = customProperties(host, /:root/),
    hostDay = customProperties(host, /:root\[data-theme=['"]?light['"]?\]/);
  const night = customProperties(viewer, /:root/),
    day = customProperties(viewer, /@media \(prefers-color-scheme:\s*light\)\s*\{\s*:root/);
  for (const [name, value] of Object.entries(night))
    if (name in hostNight) assert.equal(value, hostNight[name], `${name} by night`);
  for (const [name, value] of Object.entries(day))
    assert.equal(value, hostDay[name], `${name} by day`);
  const colors = Object.keys(night).filter((name) => night[name].startsWith('#'));
  assert.deepEqual(
    colors.filter((name) => !(name in day)),
    [],
    'colors without a day value',
  );
});

test('the viewer pages offer both color schemes, and Android’s Disconnect is the last button on the right', () => {
  const colorScheme = /<meta name="color-scheme" content="dark light"\s*\/?>/;
  assert.match(read('public/client.html'), colorScheme);
  const android = read('src/windows/android/viewer.html');
  assert.match(android, colorScheme);
  const last = buttons(element(android, /<nav class="vtools"/)).at(-1);
  assert.equal(last.id, 'disconnect');
  assert.match(last.tag, /\bclass="ghost"/);
  assert.match(text(last.html), /Disconnect$/);
});
