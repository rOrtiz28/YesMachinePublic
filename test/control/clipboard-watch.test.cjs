'use strict';

// Tests the sending side of the shared clipboard (src/main/control/clipboard-watch.cjs). The clipboard is a stand-in
// object whose text the tests change, and the timer is replaced, so the tests run each read themselves.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClipboardWatch } = require('../../src/main/control/clipboard-watch.cjs');

/**
 * A watch over a stand-in clipboard that starts with `initial`. `sent` collects what the watch hands on, and tick()
 * runs the read the watch scheduled, or nothing once its timer is cleared.
 */
function setup(initial = 'before') {
  const clipboard = {
      text: initial,
      readText() {
        return this.text;
      },
    },
    sent = [];
  let tick = null;
  const watch = createClipboardWatch({
    clipboard,
    onChange: (text) => sent.push(text),
    setTimer: (fn) => {
      tick = fn;
      return 1;
    },
    clearTimer: () => {
      tick = null;
    },
  });
  return { clipboard, sent, watch, tick: () => tick?.() };
}

test('only what is copied after a viewer connects goes across, once per change', () => {
  const { clipboard, sent, watch, tick } = setup();
  watch.start();
  tick();
  assert.deepEqual(sent, [], 'what was there before stays here');
  clipboard.text = 'copied on the computer';
  tick();
  tick();
  assert.deepEqual(sent, ['copied on the computer']);
  clipboard.text = '';
  tick();
  assert.deepEqual(sent, ['copied on the computer'], 'an empty clipboard is not sent');
});

test('text the viewer sent is not sent back, and nothing goes across once stopped', () => {
  const { clipboard, sent, watch, tick } = setup();
  watch.start();
  watch.note('from the viewer');
  clipboard.text = 'from the viewer';
  tick();
  assert.deepEqual(sent, []);
  watch.stop();
  assert.equal(watch.running, false);
  clipboard.text = 'later';
  tick();
  assert.deepEqual(sent, []);
});
