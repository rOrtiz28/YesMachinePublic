'use strict';

// Tests the Hide bars button in both viewers: the Android window (src/windows/android/viewer.html) and the browser
// viewer (public/client.html). It reads their HTML source and checks the order of the buttons; no browser runs.
// The button sits beside Full screen, and the small bar that stays at the top while the bars are hidden (#fs-bar)
// brings them back. It also checks, in the style sheet, that the browser viewer's picture fits the screen in full
// screen and with the bars hidden.

const test = require('node:test');
const assert = require('node:assert/strict');
const { read, element, buttons } = require('../helpers/markup.cjs');

/** The ids of the buttons in some HTML, in the order they appear. */
const ids = (html) => buttons(html).map((button) => button.id);

test('both viewers can hide their bars beside Full screen, and their small bar brings them back', () => {
  const android = read('src/windows/android/viewer.html');
  const computer = read('public/client.html');

  const middle = ids(element(android, /<div class="vcenter">/));
  assert.equal(
    middle[middle.indexOf('fullscreen') + 1],
    'bars',
    'in the Android window, Hide bars is right of Full screen',
  );

  const tools = ids(element(computer, /<nav class="vtools"/));
  assert.equal(
    tools[tools.indexOf('fullscreen-button') - 1],
    'bars-button',
    'in the computer viewer, left of it',
  );

  for (const html of [android, computer]) {
    const small = ids(element(html, /<div id="fs-bar"/));
    assert.ok(
      small.includes('fullscreen-exit') && small.includes('bars-show'),
      'the small bar has Full screen and Show bars',
    );
  }
});

test('in full screen, the browser viewer’s picture is sized by the screen, never by its own shape', () => {
  // The stage's row and column take exactly its size, so a picture narrower than the screen can't make it taller
  // than the screen and lose its bottom edge (the video then fits with object-fit: contain).
  const css = read('public/style.css');
  const rule = css.slice(
    css.indexOf('.fullscreen .vstage {'),
    css.indexOf('}', css.indexOf('.fullscreen .vstage {')),
  );
  assert.match(rule, /grid-template: minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/);
  assert.match(css, /video \{[^}]*object-fit: contain;/);
});
