'use strict';
// The shared clipboard, as the computer's Settings say: both ways, only to the computer, only from it, or off.
// What the computer copies is written here as it arrives, or at the next chance where the browser wants this page
// focused or touched first. What was copied here goes to the computer when this page comes back into focus, where
// the browser lets it read the clipboard, and otherwise as a paste begins (keyboard.js).
//
// The Clipboard panel in the drawer moves text by hand: Send, Get, Copy and Paste.

// The shared clipboard, as the computer's setting says: 'both', 'to' it, 'from' it or 'off', and null until it says.
let clipboardMode = null;
let lastClipboard = null; // the last text that went either way, so it isn't sent back
let pendingClipboard = null; // the computer's text, waiting until this page may write the clipboard
// 'granted' or 'prompt' where this page may read the clipboard, false where only a paste shows it.
let clipboardReadable = false;

/** Whether text copied here goes to the computer. */
function clipboardTo() {
  return clipboardMode === 'both' || clipboardMode === 'to';
}

/** Whether text copied on the computer comes here. */
function clipboardFrom() {
  return clipboardMode === 'both' || clipboardMode === 'from';
}

/** The Clipboard panel's line that says how the clipboard is shared. */
function renderClipboardMode() {
  const name = hostName || 'the computer',
    line = $('clipboard-mode');
  line.textContent =
    clipboardMode === 'both'
      ? `Shared both ways: what you copy here or on ${name} is ready to paste on the other.`
      : clipboardMode === 'to'
        ? `Shared to ${name} only: what you copy here is ready to paste there.`
        : clipboardMode === 'from'
          ? `Shared from ${name} only: what you copy there is ready to paste here.`
          : clipboardMode === 'off'
            ? `Automatic sharing is off on ${name}. Move text with the buttons below.`
            : `Move text between this device and ${name}.`;
  line.classList.toggle('off', !clipboardTo() && !clipboardFrom());
}

/** Writes text to this device's clipboard, or keeps it for later when the browser doesn't allow it now. */
async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    pendingClipboard = null;
  } catch {
    pendingClipboard = text;
  }
}

/** Sends text copied here to the computer, unless it is what last went either way or too large for one message. */
function sendClipboard(text) {
  if (!clipboardTo() || typeof text !== 'string' || !text || text === lastClipboard) return;
  if (new TextEncoder().encode(text).length > 60000) return; // more than fits in one message stays here
  lastClipboard = text;
  sendControl({ type: 'clipboard-auto', text });
}

/** This device's clipboard, or nothing when it can't be read within `wait` milliseconds. */
async function readClipboard(wait = 300) {
  if (!navigator.clipboard?.readText) return '';
  try {
    return await Promise.race([
      navigator.clipboard.readText(),
      new Promise((resolve) => setTimeout(() => resolve(''), wait)),
    ]);
  } catch {
    return '';
  }
}
// The text of the paste the browser is about to make, or nothing if none comes.
function nextPaste() {
  return new Promise((resolve) => {
    const done = (event) => {
      clearTimeout(timer);
      resolve(event.clipboardData?.getData('text/plain') || '');
    };
    const timer = setTimeout(() => {
      document.removeEventListener('paste', done);
      resolve('');
    }, 300);
    document.addEventListener('paste', done, { once: true });
  });
}

/**
 * When the page comes back into focus: writes the computer's text that was waiting, and sends what was copied here
 * meanwhile, where the page may read the clipboard. In the desktop app, __yesMachineClipboardChanged says whether
 * anything was copied at all.
 */
async function clipboardFocus() {
  if (pendingClipboard !== null) writeClipboard(pendingClipboard);
  if (!paired || !clipboardTo() || clipboardReadable !== 'granted') return;
  if (window.__yesMachineClipboardChanged && !window.__yesMachineClipboardChanged()) return;
  sendClipboard(await readClipboard());
}

/** Connects the events that move the clipboard, and the panel's buttons. Called once by start.js. */
function setUpClipboard() {
  window.addEventListener('focus', clipboardFocus);
  for (const type of ['pointerdown', 'keydown'])
    document.addEventListener(
      type,
      () => {
        if (pendingClipboard !== null) writeClipboard(pendingClipboard);
      },
      true,
    );
  $('clipboard-send').addEventListener('click', () => {
    const message = { type: 'clipboard-set', text: $('clipboard-text').value };
    if (new TextEncoder().encode(JSON.stringify(message)).length > 60000) {
      showNotice('Use a file for clipboard text larger than 60 KB.', true);
      return;
    }
    lastClipboard = message.text;
    if (sendControl(message)) showNotice('Clipboard text sent to the host.');
    else showNotice('The control connection is not ready.', true);
  });
  $('clipboard-get').addEventListener('click', () => controlAction({ type: 'clipboard-get' }));
  $('clipboard-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('clipboard-text').value);
      showNotice('Copied to this device.');
    } catch {
      $('clipboard-text').focus();
      $('clipboard-text').select();
      showNotice('Clipboard permission is unavailable. Copy the selected text manually.');
    }
  });
  $('clipboard-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.length > MAX_TEXT) throw new Error('size');
      $('clipboard-text').value = text;
    } catch (error) {
      showNotice(
        error.message === 'size'
          ? 'Clipboard text is too large. Paste up to 1 MB of text.'
          : 'Clipboard access is unavailable. Paste into the text box manually.',
      );
      $('clipboard-text').focus();
    }
  });
}
