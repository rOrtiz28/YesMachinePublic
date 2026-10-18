'use strict';
// Decides what the browser viewer (client/keyboard.js) sends to the remote computer for the keys pressed
// here. It is kept apart from the page so that it can be tested (test/pages/desktop-keys.test.cjs).
//
// Keys go by position (KeyboardEvent.code, with the key's value alongside), as they are pressed,
// except when a Mac (or an iPad or iPhone) controls a Windows or Linux computer. Then the Mac's
// shortcuts do what they do on a Mac:
//  - ⌘ works as Ctrl.
//  - ⌘← and ⌘→ go to the start and end of the line (Home, End); ⌘↑ and ⌘↓ go to the start and
//    end of the text (Ctrl+Home, Ctrl+End).
//  - ⌥← and ⌥→ move by word, and ⌥⌫ deletes one (Ctrl with the same key).
//  - ⌘Q, ⌘W, ⌘H and ⌘M stay with the Mac, as in the Android window.
// ⌘ and ⌥ reach the computer only together with the key or click they go with, never on their
// own. That way a Mac shortcut never passes through a Windows one on the way (⌥ and then ← would
// otherwise arrive as Alt+←, which is Back in a browser). The Windows key isn't ⌘ either: it's a
// button in the viewer's tool drawer, in the Keyboard panel.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesktopKeys = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // ⌘ shortcuts that belong to the Mac's own windows: ⌘Q quit, ⌘W close, ⌘H hide, ⌘M minimize,
  // ⌘` the next window and ⌘, settings.
  const MAC_WINDOW_KEYS = new Set(['KeyQ', 'KeyW', 'KeyH', 'KeyM', 'Backquote', 'Comma']);
  // The modifier keys here, by position.
  const MODIFIERS = {
    ShiftLeft: 'shift',
    ShiftRight: 'shift',
    ControlLeft: 'control',
    ControlRight: 'control',
    AltLeft: 'alt',
    AltRight: 'alt',
    MetaLeft: 'meta',
    MetaRight: 'meta',
  };
  // The keys pressed on the computer for the modifiers its shortcuts need.
  const REMOTE = {
    control: { key: 'Control', code: 'ControlLeft' },
    alt: { key: 'Alt', code: 'AltLeft' },
    shift: { key: 'Shift', code: 'ShiftLeft' },
  };
  const named = (name) => ({ key: name, code: name });
  // A Mac's text shortcuts as Windows and Linux spell them: whether Ctrl goes with it, and the key.
  // First ⌘ with an arrow, then ⌥ with an arrow, Backspace or Delete.
  const WITH_COMMAND = {
    ArrowLeft: [false, named('Home')],
    ArrowRight: [false, named('End')],
    ArrowUp: [true, named('Home')],
    ArrowDown: [true, named('End')],
  };
  const WITH_OPTION = {
    ArrowLeft: [true, named('ArrowLeft')],
    ArrowRight: [true, named('ArrowRight')],
    ArrowUp: [true, named('ArrowUp')],
    ArrowDown: [true, named('ArrowDown')],
    Backspace: [true, named('Backspace')],
    Delete: [true, named('Delete')],
  };

  /**
   * Creates the key translator for one viewer page.
   * @param mac true when this device is a Mac, an iPad or an iPhone.
   * @returns an object with:
   *  - down(event) and up(event): take a KeyboardEvent's key, code, shiftKey, ctrlKey, altKey and
   *    metaKey, and return the { key, code, down } messages for the computer, in order. down()
   *    returns null for a key this device keeps.
   *  - pointer(event): the messages that go before a click, so ⌘-click arrives as Ctrl-click.
   *  - release(): forgets what is held, once the computer has been told to let go of everything.
   *  - setHost(platform): tells it the computer's platform ('darwin', 'win32' or 'linux').
   */
  function createKeyboard({ mac = false } = {}) {
    let host = ''; // the computer's platform, '' until it is known
    const held = new Map(); // KeyboardEvent.code here -> the key the computer got for it
    const remote = new Set(); // modifiers held on the computer for this device's shortcuts
    // Mac shortcuts are translated only for a computer that is known not to be a Mac.
    const translating = () => mac && host !== '' && host !== 'darwin';

    /**
     * Presses and releases the computer's modifiers until they are the ones wanted.
     * @param wanted { shift, control, alt }, each true or false.
     * @returns the key messages that do it.
     */
    function match(wanted) {
      const messages = [];
      for (const name of Object.keys(REMOTE)) {
        if (wanted[name] && !remote.has(name)) {
          remote.add(name);
          messages.push({ ...REMOTE[name], down: true });
        } else if (!wanted[name] && remote.has(name)) {
          remote.delete(name);
          messages.push({ ...REMOTE[name], down: false });
        }
      }
      return messages;
    }

    /** Returns the messages for a key going down, or null for a key that stays with the Mac. */
    function down(event) {
      // Without translation, the key goes as pressed, and is remembered for its release.
      if (!translating()) {
        held.set(event.code, { key: event.key, code: event.code });
        return [{ key: event.key, code: event.code, down: true }];
      }
      const modifier = MODIFIERS[event.code];
      // Shift and Control go across at once, and the computer's other modifiers stay as they are.
      if (modifier === 'shift' || modifier === 'control')
        return match({
          shift: event.shiftKey,
          control: event.ctrlKey || remote.has('control'),
          alt: remote.has('alt'),
        });
      if (modifier) return []; // ⌘ and ⌥ wait for their key
      if (event.metaKey && MAC_WINDOW_KEYS.has(event.code)) return null;
      // The modifiers the computer needs for this key, and the key it gets.
      let control = event.ctrlKey,
        alt = false,
        key = { key: event.key, code: event.code };
      if (event.metaKey) {
        // ⌘ with an arrow becomes Home or End (with Ctrl for ↑ and ↓), and with any other key it
        // is Ctrl. ⌥ held as well is Alt.
        const shortcut = WITH_COMMAND[event.code];
        if (shortcut) {
          control = shortcut[0] || event.ctrlKey;
          key = shortcut[1];
        } else control = true;
        alt = event.altKey;
      } else if (event.altKey) {
        // ⌥ with an arrow, Backspace or Delete moves or deletes by word, which takes Ctrl on
        // Windows and Linux. With any other key it is Alt.
        const shortcut = WITH_OPTION[event.code];
        if (shortcut) {
          control = true;
          key = shortcut[1];
        } else alt = true;
      }
      const messages = match({ shift: event.shiftKey, control, alt });
      held.set(event.code, key); // so the release lets go of the key that was sent
      messages.push({ ...key, down: true });
      return messages;
    }

    /** Returns the messages for a key going up. */
    function up(event) {
      if (translating() && MODIFIERS[event.code]) {
        // Let go of what the modifiers still held no longer explain. Ctrl on the computer can stand
        // for Ctrl, ⌘ or ⌥ here, so it stays while any of them is down.
        return match({
          shift: event.shiftKey && remote.has('shift'),
          control: (event.ctrlKey || event.metaKey || event.altKey) && remote.has('control'),
          alt: event.altKey && remote.has('alt'),
        });
      }
      // Any other key lets go of what was sent for it, if anything was.
      const key = held.get(event.code);
      if (!key) return [];
      held.delete(event.code);
      return [{ ...key, down: false }];
    }

    /**
     * Returns the modifier messages that go before a click, so ⌘-click arrives as Ctrl-click and
     * ⌥-click as Alt-click. Without translation there are none: the modifiers went as keys.
     */
    function pointer(event) {
      if (!translating()) return [];
      return match({
        shift: event.shiftKey,
        control: event.ctrlKey || event.metaKey,
        alt: event.altKey,
      });
    }

    /** Forgets every held key and modifier. */
    function release() {
      held.clear();
      remote.clear();
    }

    /** Sets the computer's platform. A different one starts over, with nothing held. */
    function setHost(platform) {
      platform = String(platform || '');
      if (platform !== host) {
        release();
        host = platform;
      }
    }

    return { down, up, pointer, release, setHost };
  }

  return { createKeyboard };
});
