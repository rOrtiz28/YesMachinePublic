'use strict';
// The sending side of the shared clipboard: while it runs, this computer's clipboard is read twice a second, and each
// change is handed on, to go to the other side. main.cjs uses one for the viewer connected to this computer (started
// and stopped as the host page asks), and android/windows.cjs one for the Android devices this computer controls.
// Text that came from the other side is noted first, before it is written to the clipboard, so it isn't sent back.

/**
 * Creates a clipboard watch.
 *
 * - clipboard: has readText(). A read that fails, or doesn't give a string, counts as empty.
 * - onChange(text): hears each new text. An emptied clipboard isn't reported.
 * - interval: the milliseconds between reads. setTimer and clearTimer are setInterval and clearInterval unless a test
 *   passes its own.
 *
 * Returns {start, stop, note, running}.
 */
function createClipboardWatch({
  clipboard,
  onChange,
  interval = 500,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  // last is the text seen last, by a read or through note().
  let timer = null,
    last = null;
  const read = () => {
    try {
      const text = clipboard.readText();
      return typeof text === 'string' ? text : '';
    } catch {
      return '';
    }
  };
  /** Reads the clipboard and reports its text if it changed. */
  function check() {
    const text = read();
    if (text === last) return;
    last = text;
    if (text) onChange(text);
  }
  return {
    // Starting takes what's there now as already seen: only what's copied from then on goes across.
    start() {
      if (timer) return;
      last = read();
      timer = setTimer(check, interval);
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
    // Text from the other side, about to be written to this computer's clipboard: seen already, so not sent back.
    note(text) {
      last = text;
    },
    get running() {
      return Boolean(timer);
    },
  };
}

module.exports = { createClipboardWatch };
