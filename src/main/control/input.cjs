'use strict';
// Plays a viewer's keyboard and mouse on this computer, and checks every message first. main.cjs creates one controller
// and hands it each input message from the viewer: the viewer page (public/client/) sends small JSON messages over its
// WebRTC data channel, the host window (src/windows/host/viewer-connection.js) passes them to main.cjs's 'input'
// handler, and that calls handle() here. The input itself goes through RobotJS (@jitsi/robotjs) on macOS, Windows and
// X11, or, in a Wayland session, through the object with the same methods that portal-input.cjs makes.
//
// The main ideas:
// - Nothing reaches the native library unless allowed() returns true. The default is to deny.
// - Pointer positions arrive as fractions (0 to 1) of the shared screen and become pixels inside its bounds.
// - A key is named by the physical key (KeyboardEvent.code) when the browser knows it, and goes through an allow-list
//   to a RobotJS key name. Nothing the viewer sends is passed on as a native key name.
// - The controller remembers which keys and buttons this session holds down, so releaseAll() can let go of exactly
//   those when the viewer leaves or loses permission.

// --- Limits and key tables ---

const MAX_TEXT_LENGTH = 10000; // the longest text message, in UTF-16 code units
const MAX_CLIPBOARD_BYTES = 1024 * 1024; // clipboard text, in UTF-8 bytes
const MAX_WHEEL_INPUT = 10000; // the largest wheel delta accepted from the viewer
const MAX_WHEEL_OUTPUT = 1000; // the largest amount passed to RobotJS for one wheel message
// DOM MouseEvent.button numbers (0 main, 1 middle, 2 secondary) to RobotJS button names.
const BUTTONS = ['left', 'middle', 'right'];
// The RobotJS key names that are modifiers, each with the modifier flag it sets on macOS (see toggleKey).
const MODIFIERS = new Map([
  ['shift', 'shift'],
  ['right_shift', 'shift'],
  ['control', 'control'],
  ['left_control', 'control'],
  ['right_control', 'control'],
  ['alt', 'alt'],
  ['right_alt', 'alt'],
  ['command', 'command'],
]);
// Physical key codes (KeyboardEvent.code) to RobotJS key names. Letters, digits, function keys and the numpad are
// matched by pattern in resolveKey instead.
const CODES = Object.freeze({
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Backspace: 'backspace',
  Tab: 'tab',
  Space: 'space',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  CapsLock: 'capslock',
  ShiftLeft: 'shift',
  ShiftRight: 'right_shift',
  ControlLeft: 'left_control',
  ControlRight: 'right_control',
  AltLeft: 'alt',
  AltRight: 'right_alt',
  // RobotJS names its K_META key "command" on every platform: Command on a Mac, the Windows key on Windows, Super on
  // Linux. https://github.com/jitsi/robotjs/blob/master/src/keycode.h
  MetaLeft: 'command',
  MetaRight: 'command',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
});
// Key names (KeyboardEvent.key) to RobotJS key names, for keys that arrive without a physical code (see resolveKey).
const NAMED_KEYS = Object.freeze({
  Enter: 'enter',
  Escape: 'escape',
  Backspace: 'backspace',
  Tab: 'tab',
  ' ': 'space',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  CapsLock: 'capslock',
  Shift: 'shift',
  Control: 'control',
  Alt: 'alt',
  Meta: 'command',
});

// --- Errors and checks ---

/** Makes an Error with a code (such as 'INVALID_INPUT'), so callers can tell the reasons apart. */
function inputError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Throws an INVALID_INPUT error: the message itself is malformed or out of range. */
function invalid(message) {
  throw inputError('INVALID_INPUT', message);
}

/**
 * Checks a screen rectangle {x, y, width, height} in the units native input takes: whole numbers, a position within a
 * million of the origin and a size from 1 to 131072. Returns a copy of it, or throws INVALID_INPUT.
 */
function validateBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Invalid screen bounds.');
  const { x, y, width, height } = value;
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    Math.abs(x) > 1000000 ||
    Math.abs(y) > 1000000 ||
    width < 1 ||
    height < 1 ||
    width > 131072 ||
    height > 131072
  ) {
    invalid('Screen bounds must contain finite integer coordinates and positive dimensions.');
  }
  return { x, y, width, height };
}

// --- Keys ---

/**
 * Turns a key message ({code, key}) into the RobotJS key to press, or throws UNSUPPORTED_KEY.
 *
 * Returns {id, nativeKey}. nativeKey is the RobotJS key name. id names the key the viewer pressed, so that its release
 * can be matched to its press: "code:<code>" for a physical key, or "key:<RobotJS name>" when there is no code. Going
 * by the physical code, a key still matches its press when its character changed in between (Shift was let go).
 *
 * Only keys that RobotJS defines on this platform are accepted (src/keycode.h in RobotJS): a Mac has no F21 to F24,
 * Insert, Print Screen, menu key or Num Lock, and X11 has no numpad keys, menu key or Num Lock. A code that isn't
 * recognized is refused rather than tried by its key name, so the viewer can't reach arbitrary native keys.
 */
function resolveKey(message, platform) {
  const { code, key } = message;
  if (code !== undefined && (typeof code !== 'string' || code.length > 40))
    invalid('Invalid key code.');
  if (key !== undefined && (typeof key !== 'string' || key.length > 40))
    invalid('Invalid key name.');
  let nativeKey;
  let id;
  // A physical key. Browsers send an empty code or "Unidentified" when they don't know it.
  if (code && code !== 'Unidentified') {
    id = `code:${code}`;
    if (Object.hasOwn(CODES, code)) nativeKey = CODES[code];
    else if (/^Key[A-Z]$/.test(code)) nativeKey = code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(code)) nativeKey = code.slice(5);
    else if (
      /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code) &&
      (platform !== 'darwin' || Number(code.slice(1)) <= 20)
    )
      nativeKey = code.toLowerCase();
    // X11 RobotJS has no numpad keys, so on Linux a numpad digit types the main row's digit.
    else if (/^Numpad[0-9]$/.test(code))
      nativeKey = platform === 'linux' ? code.slice(6) : `numpad_${code.slice(6)}`;
    else if (
      Object.hasOwn(
        { NumpadAdd: 1, NumpadSubtract: 1, NumpadMultiply: 1, NumpadDivide: 1, NumpadDecimal: 1 },
        code,
      )
    ) {
      const character = {
        NumpadAdd: '+',
        NumpadSubtract: '-',
        NumpadMultiply: '*',
        NumpadDivide: '/',
        NumpadDecimal: '.',
      }[code];
      // X11 RobotJS has no numpad keys, so Linux falls back to the main keyboard's key for the same character. On the
      // main row, + and * need Shift, which depends on the keyboard layout, so only the operators typed without a
      // modifier (-, / and .) have a safe fallback.
      if (platform !== 'linux') nativeKey = `numpad_${character}`;
      else if ('-/.'.includes(character)) nativeKey = character;
    } else if (platform !== 'darwin' && code === 'Insert') nativeKey = 'insert';
    else if (platform !== 'darwin' && code === 'PrintScreen') nativeKey = 'printscreen';
    else if (platform === 'win32' && code === 'ContextMenu') nativeKey = 'menu';
    else if (platform === 'win32' && code === 'NumLock') nativeKey = 'numpad_lock';
  } else if (typeof key === 'string') {
    // Android software keyboards often send no physical code. Composed text should come as a text message; this
    // fallback handles ordinary ASCII keys by their key name.
    if (Object.hasOwn(NAMED_KEYS, key)) nativeKey = NAMED_KEYS[key];
    else if (/^[a-zA-Z0-9\-=[\]\\;',./`]$/.test(key)) nativeKey = key.toLowerCase();
    else if (
      /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key) &&
      (platform !== 'darwin' || Number(key.slice(1)) <= 20)
    )
      nativeKey = key.toLowerCase();
    // By the RobotJS name, which is lowercase, so "A" and "a" are the same key.
    id = `key:${nativeKey}`;
  }
  if (!nativeKey)
    throw inputError(
      'UNSUPPORTED_KEY',
      'This key is not supported. Use text or clipboard transfer for composed text.',
    );
  return { id, nativeKey };
}

// --- The controller ---

/**
 * Creates the input controller. All its methods are synchronous.
 *
 * Options:
 * - robot: RobotJS, or an object with the same methods (portal-input.cjs). Without one, input is unavailable.
 * - clipboard: an object with readText() and writeText(text), such as Electron's clipboard.
 * - bounds: the shared screen's rectangle in native input units, or a function that returns it.
 * - allowed(): returns true while the viewer may control this computer. The default always denies.
 * - platform: process.platform, which decides the key and wheel rules.
 * - onError(error): hears every error that handle() throws or that releaseAll() runs into.
 *
 * handle(message) checks allowed() first, for every message, clipboard ones included. Malformed messages and native
 * failures are reported to onError and thrown, with an Error.code when there is one: INPUT_DENIED, INVALID_INPUT,
 * UNSUPPORTED_KEY, UNSUPPORTED_TEXT, INPUT_UNAVAILABLE, INPUT_BUSY, CLIPBOARD_UNAVAILABLE or CLIPBOARD_TOO_LARGE.
 * The messages it takes:
 * - pointer {x, y in [0, 1], action: move | down | up, button: 0 | 1 | 2}
 * - double-click {x, y in [0, 1], button: 0 | 1 | 2}, only while no keys or buttons are held
 * - wheel {dx, dy}, DOM pixel deltas, positive to the right and down
 * - key {code, key, down: boolean}
 * - text {text}
 * - clipboard-get, which returns {type: 'clipboard', text}. Every other message returns null.
 * - clipboard-set {text}
 * - release-all, or release
 * (In the app, main.cjs answers clipboard-get and clipboard-set itself, before they reach handle().)
 *
 * releaseAll() is trusted local cleanup, so it doesn't ask allowed(). Call it on blur, when the viewer disconnects,
 * when its permission is taken away and when this computer stops sharing. It tries every release even when a native
 * call fails, and returns the errors it ran into.
 *
 * setBounds(bounds) changes the shared screen, and available says whether a native library was given.
 */
function createInputController({
  robot,
  clipboard,
  bounds,
  allowed = () => false,
  platform = process.platform,
  onError,
} = {}) {
  // A function is asked again on every move; a rectangle is checked once, here.
  let screenBounds = typeof bounds === 'function' ? bounds : bounds ? validateBounds(bounds) : null;
  // What this session holds down: keys by id (see resolveKey) with their RobotJS names, and buttons by RobotJS name.
  const pressedKeys = new Map();
  const pressedButtons = new Set();
  const available = Boolean(robot);

  /** Passes an error to onError, if there is one. An onError that throws is ignored. */
  function report(error) {
    if (typeof onError === 'function') {
      try {
        onError(error);
      } catch {
        /* Error reporting must not prevent cleanup. */
      }
    }
  }

  /** Throws INPUT_UNAVAILABLE unless the native library has this method. */
  function requireRobot(method) {
    if (!robot || typeof robot[method] !== 'function') {
      throw inputError('INPUT_UNAVAILABLE', 'Native input is unavailable on this host.');
    }
  }

  /** The modifier flags for the keys in keys (a map like pressedKeys), each flag once. */
  function flags(keys = pressedKeys) {
    return [...new Set([...keys.values()].map((value) => MODIFIERS.get(value)).filter(Boolean))];
  }

  /**
   * Presses or releases one RobotJS key. keys is what will be held once this change is made, which gives the event
   * its modifier flags on macOS.
   */
  function toggleKey(nativeKey, down, keys = pressedKeys) {
    requireRobot('keyToggle');
    // On macOS each key event's modifier flags (CGEvent flags) must be given explicitly. On Windows and X11, passing
    // modifiers would press and release them again with every key, which breaks shortcuts the viewer is holding.
    if (platform === 'darwin') robot.keyToggle(nativeKey, down ? 'down' : 'up', flags(keys));
    else robot.keyToggle(nativeKey, down ? 'down' : 'up');
  }

  /**
   * Lets go of every key and mouse button this session holds: ordinary keys first, then modifiers, then buttons. It
   * only releases what this session pressed, never keys held by the person at this computer. A key or button whose
   * release fails stays recorded, so the next call tries it again. Returns the errors it ran into.
   */
  function releaseAll() {
    const errors = [];
    // Entries are [id, nativeKey]; ordinary keys sort before modifiers.
    const ordered = [...pressedKeys].sort(
      (a, b) => Number(MODIFIERS.has(a[1])) - Number(MODIFIERS.has(b[1])),
    );
    for (const [id, nativeKey] of ordered) {
      const next = new Map(pressedKeys);
      next.delete(id);
      try {
        // Two ids can share a native key (both Meta keys are 'command'); it goes up with the last of them.
        if (![...next.values()].includes(nativeKey)) toggleKey(nativeKey, false, next);
        pressedKeys.delete(id);
      } catch (error) {
        errors.push(error);
        report(error);
      }
    }
    for (const button of [...pressedButtons]) {
      try {
        requireRobot('mouseToggle');
        robot.mouseToggle('up', button);
        pressedButtons.delete(button);
      } catch (error) {
        errors.push(error);
        report(error);
      }
    }
    return errors;
  }

  /**
   * Moves the pointer to (x, y), given as fractions of the shared screen. 0 is its first pixel and 1 its last, so
   * both edges can be reached and the pointer never leaves the screen.
   */
  function movePointer(x, y) {
    const current = validateBounds(
      typeof screenBounds === 'function' ? screenBounds() : screenBounds,
    );
    const pixelX = current.x + Math.round(x * (current.width - 1));
    const pixelY = current.y + Math.round(y * (current.height - 1));
    // On macOS, apps see a drag only in drag events, so a move with a button held is made with dragMouse (with the
    // first button held).
    if (platform === 'darwin' && pressedButtons.size) {
      requireRobot('dragMouse');
      robot.dragMouse(pixelX, pixelY, pressedButtons.values().next().value);
    } else {
      requireRobot('moveMouse');
      robot.moveMouse(pixelX, pixelY);
    }
  }

  /** Checks one message from the viewer and plays it. See createInputController for the messages. */
  function handle(message) {
    try {
      // Denied input also lets go of anything held, in case permission was taken away in the middle of a shortcut or
      // a drag.
      if (typeof allowed !== 'function' || allowed() !== true) {
        releaseAll();
        throw inputError('INPUT_DENIED', 'The host has not enabled control for this session.');
      }
      if (
        !message ||
        typeof message !== 'object' ||
        Array.isArray(message) ||
        typeof message.type !== 'string'
      )
        invalid('Invalid input message.');

      switch (message.type) {
        // RobotJS's own double click. It is refused while this session holds keys or buttons, so it is always a
        // plain double click.
        case 'double-click': {
          const { x, y, button } = message;
          if (
            ![x, y].every(
              (value) =>
                typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
            )
          ) {
            invalid('Pointer coordinates must be finite numbers between 0 and 1.');
          }
          if (!Number.isInteger(button) || button < 0 || button > 2)
            invalid('Invalid pointer button.');
          if (pressedKeys.size || pressedButtons.size) {
            throw inputError(
              'INPUT_BUSY',
              'Release held keys and mouse buttons before double-clicking.',
            );
          }
          requireRobot('mouseClick');
          movePointer(x, y);
          robot.mouseClick(BUTTONS[button], true);
          break;
        }
        case 'pointer': {
          const { x, y, action, button } = message;
          if (
            ![x, y].every(
              (value) =>
                typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
            )
          ) {
            invalid('Pointer coordinates must be finite numbers between 0 and 1.');
          }
          if (!['move', 'down', 'up'].includes(action)) invalid('Invalid pointer action.');
          if (action !== 'move' && (!Number.isInteger(button) || button < 0 || button > 2))
            invalid('Invalid pointer button.');
          const nativeButton = BUTTONS[button];
          // Only buttons this session pressed are released; any other 'up' is ignored.
          if (action === 'up' && !pressedButtons.has(nativeButton)) return null;
          // Checked before the move, so a missing method fails before anything happens.
          if (action !== 'move') requireRobot('mouseToggle');
          movePointer(x, y);
          // A 'down' for a button already held only moves the pointer.
          if (action === 'down' && !pressedButtons.has(nativeButton)) {
            robot.mouseToggle('down', nativeButton);
            pressedButtons.add(nativeButton);
          } else if (action === 'up') {
            robot.mouseToggle('up', nativeButton);
            pressedButtons.delete(nativeButton);
          }
          break;
        }
        case 'wheel': {
          const { dx, dy } = message;
          if (
            ![dx, dy].every(
              (value) =>
                typeof value === 'number' &&
                Number.isFinite(value) &&
                Math.abs(value) <= MAX_WHEEL_INPUT,
            )
          ) {
            invalid('Wheel deltas must be finite numbers within the permitted range.');
          }
          requireRobot('scrollMouse');
          // RobotJS counts positive amounts up and left, the DOM down and right, hence the minus sign, and any delta
          // that isn't zero scrolls at least one step. macOS and Windows take the amount as it is, but X11 only has
          // whole wheel clicks, and RobotJS sends each one as a button press and release. So on Linux the pixels are
          // divided by 40, and the cap keeps one message to at most 25 clicks.
          const convert = (value) => {
            if (value === 0) return 0;
            const magnitude = Math.min(Math.abs(value), MAX_WHEEL_OUTPUT);
            return (
              -Math.sign(value) *
              Math.max(1, Math.round(platform === 'linux' ? magnitude / 40 : magnitude))
            );
          };
          if (dx || dy) robot.scrollMouse(convert(dx), convert(dy));
          break;
        }
        case 'key': {
          if (typeof message.down !== 'boolean') invalid('Key down must be a boolean.');
          const { id, nativeKey } = resolveKey(message, platform);
          // A release of a key this session didn't press is ignored.
          if (!message.down && !pressedKeys.has(id)) return null;
          // What will be held after this message, for the macOS modifier flags.
          const next = new Map(pressedKeys);
          if (message.down) {
            next.set(id, nativeKey);
            const alreadyHeld = [...pressedKeys.values()].includes(nativeKey);
            // Repeated presses of an ordinary key (auto-repeat) are passed on, but a modifier that is already held
            // isn't pressed twice: both Meta keys map to the same native key.
            if (!alreadyHeld || !MODIFIERS.has(nativeKey)) toggleKey(nativeKey, true, next);
            pressedKeys.set(id, nativeKey);
          } else {
            next.delete(id);
            // The native key goes up only when no other held key shares it.
            if (![...next.values()].includes(nativeKey)) toggleKey(nativeKey, false, next);
            pressedKeys.delete(id);
          }
          break;
        }
        case 'text': {
          const { text } = message;
          // RobotJS reads the text as a C string, which would end at a NUL.
          if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH || text.includes('\0'))
            invalid('Text is invalid or exceeds 10,000 characters.');
          // RobotJS types each character as a single byte on X11, so only ASCII comes out right, and as a single
          // UTF-16 unit on Windows, so characters that need two (emoji, among others) can't be typed. Both are
          // refused with a hint to use the clipboard instead.
          if (platform === 'linux' && /[^\x00-\x7f]/.test(text)) {
            throw inputError(
              'UNSUPPORTED_TEXT',
              'Use clipboard transfer for non-ASCII text on Linux.',
            );
          }
          if (platform === 'win32' && /[\uD800-\uDFFF]/.test(text)) {
            throw inputError(
              'UNSUPPORTED_TEXT',
              'Use clipboard transfer for emoji and other extended Unicode text on Windows.',
            );
          }
          requireRobot('typeString');
          // Held keys are let go first, so a held shortcut can't turn the text into commands.
          if (pressedKeys.size) releaseAll();
          if (pressedKeys.size)
            throw inputError('INPUT_UNAVAILABLE', 'Could not release held keys before typing.');
          if (text) robot.typeString(text);
          break;
        }
        case 'clipboard-get': {
          if (!clipboard || typeof clipboard.readText !== 'function')
            throw inputError('CLIPBOARD_UNAVAILABLE', 'Clipboard access is unavailable.');
          const text = clipboard.readText();
          if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES) {
            throw inputError('CLIPBOARD_TOO_LARGE', 'Clipboard text exceeds 1 MiB.');
          }
          return { type: 'clipboard', text };
        }
        case 'clipboard-set': {
          const { text } = message;
          // The length is a cheap first check: in UTF-8, text never takes fewer bytes than it has UTF-16 units.
          if (
            typeof text !== 'string' ||
            text.length > MAX_CLIPBOARD_BYTES ||
            Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES
          ) {
            invalid('Clipboard text is invalid or exceeds 1 MiB.');
          }
          if (!clipboard || typeof clipboard.writeText !== 'function')
            throw inputError('CLIPBOARD_UNAVAILABLE', 'Clipboard access is unavailable.');
          clipboard.writeText(text);
          break;
        }
        case 'release':
        case 'release-all':
          releaseAll();
          break;
        default:
          invalid('Unknown input message type.');
      }
      return null;
    } catch (error) {
      report(error);
      throw error;
    }
  }

  /**
   * Changes the shared screen's bounds: a rectangle, checked now (an invalid one throws and the old bounds stay), or a
   * function asked on every move. RobotJS on Windows keeps the size of the whole virtual screen to place the pointer,
   * so it is told to measure again.
   */
  function setBounds(value) {
    screenBounds = typeof value === 'function' ? value : validateBounds(value);
    if (robot && typeof robot.updateScreenMetrics === 'function') robot.updateScreenMetrics();
  }

  return { handle, releaseAll, setBounds, available };
}

module.exports = { createInputController };
