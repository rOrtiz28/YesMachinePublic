'use strict';
// Typing on the computer. Keys pressed while the video has the focus go to the computer as key presses, translated
// by public/keys.js (DesktopKeys): for example ⌘ shortcuts from a Mac to a Windows or Linux computer, which become
// Ctrl. A paste (⌘V or Ctrl+V) sends this device's clipboard first (clipboard.js), and the keys wait behind it.
// The drawer's Keyboard panel types text, presses single keys and modifiers, and sends common shortcuts.

const keyboard = DesktopKeys.createKeyboard({ mac: /Mac|iPhone|iPad/.test(navigator.platform) });
let keyChain = null; // keys wait here while the clipboard goes ahead of a paste
let chained = 0;

// Keys keep their order: while the clipboard is on its way ahead of a paste, the next ones wait behind it.
function sendKeys(keys) {
  const send = () => {
    for (const key of keys) sendControl({ type: 'key', ...key });
  };
  if (!chained) {
    send();
    return;
  }
  chained += 1;
  keyChain = keyChain.then(send).finally(() => {
    chained -= 1;
  });
}

/** Sends this device's clipboard ahead of a paste's keys: the text, or a promise of it. */
function pasteFirst(text) {
  chained += 1;
  keyChain = (keyChain || Promise.resolve())
    .then(() => text)
    .then(sendClipboard)
    .catch(() => {})
    .finally(() => {
      chained -= 1;
    });
}

/** The Keyboard panel's text: typed on the computer, up to 10,000 characters at a time. */
function sendText() {
  const text = $('remote-text').value;
  if (!text) return;
  if (text.length > 10000) {
    showNotice('Send up to 10,000 characters at a time.', true);
    return;
  }
  if (sendControl({ type: 'text', text })) {
    $('remote-text').value = '';
    releaseInput();
  } else showNotice('The control connection is not ready.', true);
}

/** Connects the video's keys and the Keyboard panel. Called once by start.js. */
function setUpKeyboard() {
  video.addEventListener('keydown', (event) => {
    if (
      activeInput === false ||
      event.isComposing ||
      event.key === 'Process' ||
      event.key === 'Dead'
    )
      return;
    if (event.key === 'Escape' && document.fullscreenElement) {
      releaseInput();
      return;
    }
    const keys = keyboard.down(event);
    if (!keys) return; // ⌘Q and the like stay with the Mac
    // ⌘V or Ctrl+V: this device's clipboard goes to the computer first, and the keys follow it. Where the page can't
    // read the clipboard, the browser's own paste carries it, so that key isn't stopped.
    const paste =
      clipboardTo() &&
      event.code === 'KeyV' &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.repeat;
    const readable = clipboardReadable === 'granted' || clipboardReadable === 'prompt';
    if (!paste || readable) event.preventDefault();
    if (paste) pasteFirst(readable ? readClipboard() : nextPaste());
    sendKeys(keys);
  });
  video.addEventListener('keyup', (event) => {
    const keys = keyboard.up(event);
    if (!keys.length) return;
    event.preventDefault();
    sendKeys(keys);
  });
  $('send-text-button').addEventListener('click', sendText);
  $('remote-text').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      sendText();
    }
  });
  document.querySelectorAll('.key[data-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const { key, code } = button.dataset;
      if (button.classList.contains('modifier')) {
        const down = button.getAttribute('aria-pressed') !== 'true';
        if (sendControl({ type: 'key', key, code, down }))
          button.setAttribute('aria-pressed', String(down));
        else showNotice('The control connection is not ready.', true);
      } else {
        controlAction({ type: 'key', key, code, down: true });
        sendControl({ type: 'key', key, code, down: false });
      }
    });
  });
  document.querySelectorAll('[data-shortcut]').forEach((button) => {
    button.addEventListener('click', () => {
      releaseInput();
      const mac = hostPlatform === 'darwin';
      const modifier = {
        type: 'key',
        key: mac ? 'Meta' : 'Control',
        code: mac ? 'MetaLeft' : 'ControlLeft',
      };
      const key = button.dataset.shortcut;
      controlAction({ ...modifier, down: true });
      sendControl({ type: 'key', key, code: `Key${key.toUpperCase()}`, down: true });
      sendControl({ type: 'key', key, code: `Key${key.toUpperCase()}`, down: false });
      sendControl({ ...modifier, down: false });
    });
  });
}
