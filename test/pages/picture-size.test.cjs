'use strict';

// Tests src/windows/shared/picture-size.js, which sizes the shared screen's capture for the viewer's picture area:
// which 'view' messages it takes, the size every viewer gets until it reports its own, and the capture constraints
// for small, large and huge views. It also checks that the main window's page loads it before its own scripts,
// which use it as they load.

const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/markup.cjs');
const {
  DEFAULT_VIEW,
  LARGEST,
  viewFrom,
  captureFor,
} = require('../../src/windows/shared/picture-size.js');

test('a view is two whole numbers of device pixels in range; anything else is ignored', () => {
  assert.deepEqual(viewFrom({ type: 'view', width: 3024, height: 1890 }), {
    width: 3024,
    height: 1890,
  });
  assert.deepEqual(viewFrom({ width: 64, height: 16384 }), { width: 64, height: 16384 });
  for (const message of [
    null,
    {},
    { width: 1920 },
    { width: '1920', height: 1200 },
    { width: 1920.5, height: 1200 },
    { width: 63, height: 1200 },
    { width: 1920, height: 16385 },
    { width: -1920, height: 1200 },
    { width: Infinity, height: 1200 },
  ])
    assert.equal(viewFrom(message), null, JSON.stringify(message));
});

test('a viewer that hasn’t reported gets the old size: at most 1920×1200, at 60 fps', () => {
  assert.deepEqual(DEFAULT_VIEW, { width: 1920, height: 1200 });
  assert.deepEqual(captureFor(), {
    frameRate: { ideal: 60, max: 60 },
    width: { max: 1920 },
    height: { max: 1200 },
  });
});

test('the capture follows the view, up to about 4K, and only ever limits the size', () => {
  const small = captureFor({ width: 1280, height: 800 });
  assert.deepEqual([small.width, small.height], [{ max: 1280 }, { max: 800 }]);
  const retina = captureFor({ width: 3024, height: 1890 });
  assert.deepEqual([retina.width, retina.height], [{ max: 3024 }, { max: 1890 }]);
  const huge = captureFor({ width: 7680, height: 4320 });
  assert.deepEqual([huge.width, huge.height], [{ max: LARGEST.width }, { max: LARGEST.height }]);
  // Only maximums, so a screen smaller than the view is captured at its own size, never enlarged.
  for (const view of [{ width: 640, height: 400 }, LARGEST]) {
    const { width, height } = captureFor(view);
    assert.deepEqual([Object.keys(width), Object.keys(height)], [['max'], ['max']]);
  }
});

test('the main window loads the sizing before its own scripts', () => {
  const html = read('src/windows/host/host.html');
  const sizing = html.indexOf('src="../shared/picture-size.js"');
  assert.ok(sizing > 0, 'the page loads picture-size.js');
  assert.ok(sizing < html.indexOf('src="sharing.js"'), 'before sharing.js');
  assert.ok(sizing < html.indexOf('src="viewer-connection.js"'), 'and viewer-connection.js');
});
