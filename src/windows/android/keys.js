'use strict';
// Decides what the Android window (src/windows/android/viewer.js) does with a key pressed on this
// computer while it shows an Android device. It is kept apart from the page so that it can be
// tested for each system (test/android/keys.test.cjs).
//
// Characters don't go through here. They reach the device as text, through the page's hidden text
// field, typed in the computer's own layout with its accents and AltGr. This file picks the keys
// that go to the device as Android key codes instead (keys that aren't characters, and shortcuts)
// and the few that stay with the computer (the Mac's window shortcuts and full screen).
//
// The numbers are Android's KeyEvent constants: key codes (KEYCODE_*) and meta flags (META_*).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AndroidKeys = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // Keys that aren't characters, looked up by KeyboardEvent.key rather than by position, so the
  // number pad's arrows work with Num Lock off too. Android calls Backspace KEYCODE_DEL (67) and
  // Delete KEYCODE_FORWARD_DEL (112).
  const SPECIAL = {
    Enter: 66,
    Backspace: 67,
    Delete: 112,
    Tab: 61,
    Escape: 111,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Home: 122,
    End: 123,
    PageUp: 92,
    PageDown: 93,
    Insert: 124,
  };
  // Other keys by position (KeyboardEvent.code), for shortcuts.
  const POSITIONS = {
    Space: 62,
    Minus: 69,
    Equal: 70,
    BracketLeft: 71,
    BracketRight: 72,
    Backslash: 73,
    Semicolon: 74,
    Quote: 75,
    Backquote: 68,
    Comma: 55,
    Period: 56,
    Slash: 76,
  };
  // ⌘ shortcuts that belong to the Mac's own windows: ⌘Q quit, ⌘W close, ⌘H hide, ⌘M minimize,
  // ⌘` the next window and ⌘, settings.
  const MAC_WINDOW_KEYS = new Set(['KeyQ', 'KeyW', 'KeyH', 'KeyM', 'Backquote', 'Comma']);
  // Android's meta state flags: META_SHIFT_ON, META_ALT_ON, META_CTRL_ON and META_META_ON.
  const META_SHIFT = 0x1,
    META_ALT = 0x2,
    META_CTRL = 0x1000,
    META_META = 0x10000;

  /**
   * Returns the Android key code for the key in a shortcut, or null when it has none. A letter or
   * digit counts as the one it types, as on a French keyboard, where A sits where Q is on a US
   * one. Where the layout's letters aren't Latin, the key's position decides instead. Android's
   * letters start at KEYCODE_A (29) and its digits at KEYCODE_0 (7).
   */
  function shortcutCode(key, code) {
    if (/^[a-z]$/i.test(key)) return 29 + key.toLowerCase().charCodeAt(0) - 97;
    if (/^[0-9]$/.test(key)) return 7 + Number(key);
    if (/^Key[A-Z]$/.test(code)) return 29 + code.charCodeAt(3) - 65;
    if (/^Digit[0-9]$/.test(code)) return 7 + Number(code.slice(5));
    return Object.hasOwn(POSITIONS, code) ? POSITIONS[code] : null;
  }

  /**
   * Decides what happens to one key press.
   * @param event KeyboardEvent's key, code, ctrlKey, altKey, shiftKey, metaKey and isComposing,
   *   plus altGraph from getModifierState('AltGraph').
   * @param options platform: this computer's platform ('darwin' for a Mac); fullscreen: whether
   *   the window is in full screen now.
   * @returns { send, meta } for a key the device gets: an Android key code and meta state.
   *   { local } for a key this computer keeps: 'system' (left to macOS), 'fullscreen' or
   *   'exit-fullscreen'. Or null: a character, which arrives as text, a modifier on its own, or a
   *   key in the middle of composing an accent.
   */
  function keyAction(event, { platform, fullscreen = false } = {}) {
    const mac = platform === 'darwin';
    if (event.isComposing || ['Dead', 'Process', 'Unidentified'].includes(event.key)) return null;
    if (fullscreen && event.key === 'Escape') return { local: 'exit-fullscreen' };
    // ⌃⌘F on a Mac, F11 elsewhere, switches full screen on and off.
    if (mac ? event.ctrlKey && event.metaKey && event.code === 'KeyF' : event.key === 'F11')
      return { local: 'fullscreen' };
    if (mac && event.metaKey && MAC_WINDOW_KEYS.has(event.code)) return { local: 'system' };
    // Ctrl, or ⌘ on a Mac, makes a shortcut, except when AltGr is typing a character on Windows or
    // Linux (Windows reports AltGr as Ctrl and Alt together).
    const control = (event.ctrlKey || (mac && event.metaKey)) && !event.altGraph;
    const windowsKey = !mac && event.metaKey;
    // Keys that aren't characters go as themselves, F1 to F12 as KEYCODE_F1 (131) to KEYCODE_F12,
    // and any other key only as part of a shortcut.
    let send = null;
    if (Object.hasOwn(SPECIAL, event.key)) send = SPECIAL[event.key];
    else if (/^F([1-9]|1[0-2])$/.test(event.key)) send = 130 + Number(event.key.slice(1));
    else if (control || windowsKey) send = shortcutCode(event.key, event.code);
    if (send === null) return null;
    // The Alt that comes with AltGr doesn't count.
    const meta =
      (event.shiftKey ? META_SHIFT : 0) |
      (event.altKey && !event.altGraph ? META_ALT : 0) |
      (control ? META_CTRL : 0) |
      (windowsKey ? META_META : 0);
    return { send, meta };
  }

  return { keyAction };
});
