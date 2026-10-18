'use strict';
// Remote control in a Wayland session, through the desktop's RemoteDesktop portal (xdg-desktop-portal). main.cjs
// creates this only in a Wayland session, and starts it when sharing starts. input.cjs then plays the viewer's input
// through the robot object here, which offers the RobotJS methods input.cjs uses, and main.cjs reads and writes this
// computer's clipboard through the clipboard object here while the session is allowed.
//
// Why the portal: X11 input tools can't reach native Wayland windows, and the portal is the permissioned way in. The
// first time, the person at this computer approves a dialog, and the portal's restore token (kept in tokenFile) lets
// later sessions start without asking.
//
// How: a small Python helper (HELPER below) holds the portal session. It needs python3 with GObject introspection,
// which GNOME and KDE desktops include, and turns each JSON command it reads into a portal call. The same session
// asks for the clipboard too (the Clipboard portal), since a Wayland window can only reach the clipboard while it has
// focus, and while someone controls this computer, Yes Machine never has it.
//
// The states, reported to onState: 'off', 'asking' (the desktop's dialog may be showing), 'allowed', 'denied' and
// 'unavailable' (no portal, no python3, or the session failed).
const { spawn } = require('node:child_process');
const { readJson, writePrivateJson } = require('../system/private-json.cjs');

// --- The helper ---
//
// The helper's protocol, one JSON object per line. On stdin, the first line is the saved restore token, or an empty
// line. Then one command per line:
//   {"m": [x, y]}              move the pointer to an absolute position in the shared screen
//   {"b": button, "d": 1 | 0}  press (1) or release (0) a mouse button, by its evdev code
//   {"a": axis, "s": steps}    scroll; axis 0 is vertical and 1 horizontal
//   {"k": keysym, "d": 1 | 0}  press or release a key, by its X keysym
//   {"clip": text}             offer text for pasting
// On stdout it writes:
//   {"type": "ready", "stream": {node, x, y, width, height}, "token": ..., "clipboard": bool}  the session started
//   {"type": "clipboard", "text": ...}  something else was copied on this computer
//   {"type": "error", "reason": "denied" | "failed" | "unavailable", "message": ...}  the session didn't start
//   {"type": "warning", "message": ...}  a problem that doesn't end the session (ignored here)
//   {"type": "closed"}  the desktop closed the session
//
// The portal calls, in order: RemoteDesktop.CreateSession; SelectDevices (keyboard and pointer, with persist_mode 2,
// so the approval lasts until it is revoked, and the restore token when there is one); ScreenCast.SelectSources (one
// monitor); Clipboard.RequestClipboard; and RemoteDesktop.Start, which shows the dialog unless the token restores an
// earlier approval. The desktop may close the session at any time, and then the helper writes "closed".
const HELPER = String.raw`
import json, os, secrets, select, sys, threading, time
def emit(**message):
    try:
        sys.stdout.write(json.dumps(message) + '\n'); sys.stdout.flush()
    except Exception:
        pass
try:
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
except Exception as error:
    emit(type='error', reason='unavailable', message=str(error)); sys.exit(1)
NAME, PATH = 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop'
REMOTE, CAST, CLIP = 'org.freedesktop.portal.RemoteDesktop', 'org.freedesktop.portal.ScreenCast', 'org.freedesktop.portal.Clipboard'
TEXT_TYPES = ['text/plain;charset=utf-8', 'text/plain', 'UTF8_STRING', 'STRING', 'TEXT']
LIMIT = 1024 * 1024
offered, copies = [''], [0]
loop = GLib.MainLoop()
sender = bus.get_unique_name()[1:].replace('.', '_')
def request(interface, method, build):
    token = 'ym' + secrets.token_hex(8)
    path = '/org/freedesktop/portal/desktop/request/%s/%s' % (sender, token)
    answer = {}
    def on_response(connection, name, object_path, interface_name, signal, parameters):
        answer['code'], answer['results'] = parameters.unpack()
        loop.quit()
    subscription = bus.signal_subscribe(NAME, 'org.freedesktop.portal.Request', 'Response', path, None, Gio.DBusSignalFlags.NO_MATCH_RULE, on_response)
    try:
        bus.call_sync(NAME, PATH, interface, method, build(GLib.Variant('s', token)), None, Gio.DBusCallFlags.NONE, -1, None)
        loop.run()
    finally:
        bus.signal_unsubscribe(subscription)
    return answer.get('code', 2), answer.get('results', {})
restore = sys.stdin.readline().strip()
session, node, closing = None, None, []
def call(method, signature, *values):
    bus.call(NAME, PATH, REMOTE, method, GLib.Variant(signature, (session, {}) + values), None, Gio.DBusCallFlags.NONE, -1, None, None, None)
def handle(line):
    if node is None: return False
    try:
        command = json.loads(line)
        if 'm' in command: call('NotifyPointerMotionAbsolute', '(oa{sv}udd)', node, float(command['m'][0]), float(command['m'][1]))
        elif 'b' in command: call('NotifyPointerButton', '(oa{sv}iu)', int(command['b']), 1 if command['d'] else 0)
        elif 'a' in command: call('NotifyPointerAxisDiscrete', '(oa{sv}ui)', int(command['a']), int(command['s']))
        elif 'k' in command: call('NotifyKeyboardKeysym', '(oa{sv}iu)', int(command['k']), 1 if command['d'] else 0)
        elif 'clip' in command:
            offered[0] = str(command['clip'])
            bus.call(NAME, PATH, CLIP, 'SetSelection', GLib.Variant('(oa{sv})', (session, {'mime_types': GLib.Variant('as', TEXT_TYPES)})), None, Gio.DBusCallFlags.NONE, -1, None, None, None)
    except Exception as error:
        emit(type='warning', message=str(error))
    return False
# Reads from the start: when the app closes stdin or exits, the helper stops waiting, even for a dialog that is
# still on screen, and closes the portal session, which takes that dialog away.
def read():
    for line in sys.stdin:
        GLib.idle_add(handle, line)
    closing.append(True)
    GLib.idle_add(loop.quit)
threading.Thread(target=read, daemon=True).start()
def finish(status):
    if session:
        try:
            bus.call_sync(NAME, session, 'org.freedesktop.portal.Session', 'Close', None, None, Gio.DBusCallFlags.NONE, 2000, None)
        except Exception:
            pass
    sys.exit(status)
try:
    code, results = request(REMOTE, 'CreateSession', lambda token: GLib.Variant('(a{sv})', ({'handle_token': token, 'session_handle_token': GLib.Variant('s', 'ym' + secrets.token_hex(8))},)))
    if code == 0 and not closing:
        session = results['session_handle']
        options = {'types': GLib.Variant('u', 3), 'persist_mode': GLib.Variant('u', 2)}
        if restore: options['restore_token'] = GLib.Variant('s', restore)
        code, results = request(REMOTE, 'SelectDevices', lambda token: GLib.Variant('(oa{sv})', (session, dict(options, handle_token=token))))
    if code == 0 and not closing:
        code, results = request(CAST, 'SelectSources', lambda token: GLib.Variant('(oa{sv})', (session, {'handle_token': token, 'types': GLib.Variant('u', 1), 'multiple': GLib.Variant('b', False)})))
    if code == 0 and not closing:
        try:
            bus.call_sync(NAME, PATH, CLIP, 'RequestClipboard', GLib.Variant('(oa{sv})', (session, {})), None, Gio.DBusCallFlags.NONE, -1, None)
        except Exception as error:
            emit(type='warning', message='No clipboard: ' + str(error))
        code, results = request(REMOTE, 'Start', lambda token: GLib.Variant('(osa{sv})', (session, '', {'handle_token': token})))
except Exception as error:
    emit(type='error', reason='unavailable', message=str(error)); finish(1)
if closing:
    finish(0)
if code != 0:
    emit(type='error', reason='denied' if code == 1 else 'failed'); finish(1)
streams = results.get('streams') or []
if not streams or not (results.get('devices', 0) & 3) == 3:
    emit(type='error', reason='failed', message='The portal shared no screen, keyboard or pointer.'); finish(1)
stream, properties = streams[0]
x, y = properties.get('position', (0, 0))
width, height = properties.get('size', (0, 0))
clipboard = bool(results.get('clipboard_enabled', False))
emit(type='ready', stream=dict(node=stream, x=x, y=y, width=width, height=height), token=results.get('restore_token', ''), clipboard=clipboard)
node = stream
# The clipboard: what another app copies is read and reported; when another app pastes what this session offered,
# the portal asks for it.
def portal_fd(method, signature, *values):
    reply, fds = bus.call_with_unix_fd_list_sync(NAME, PATH, CLIP, method, GLib.Variant(signature, (session,) + values), GLib.VariantType('(h)'), Gio.DBusCallFlags.NONE, 5000, None, None)
    return fds.get(reply.unpack()[0])
def owner_changed(connection, name, path, interface, signal, parameters):
    owner, options = parameters.unpack()
    if owner != session: return
    copies[0] += 1
    # GNOME sends the list of types wrapped in a tuple, (as), where the portal's description has as.
    kinds = options.get('mime_types') or []
    if isinstance(kinds, tuple): kinds = kinds[0] if kinds else []
    kind = next((each for each in TEXT_TYPES[:2] if each in kinds), None)
    if options.get('session_is_owner') or not kind: return
    try:
        threading.Thread(target=read_copy, args=(portal_fd('SelectionRead', '(os)', kind), copies[0]), daemon=True).start()
    except Exception as error:
        emit(type='warning', message='Clipboard read: ' + str(error))
# The app that copied writes the text in its own time, so a thread reads it and input carries on meanwhile. It gives
# up after five seconds, and a newer copy replaces it.
def read_copy(fd, copy):
    data, ends = b'', time.monotonic() + 5
    try:
        with os.fdopen(fd, 'rb', buffering=0) as source:
            while len(data) <= LIMIT:
                if not select.select([source], [], [], max(0, ends - time.monotonic()))[0]: raise TimeoutError('the app that copied did not answer')
                chunk = source.read(65536)
                if chunk is None: continue
                if not chunk: break
                data += chunk
    except Exception as error:
        emit(type='warning', message='Clipboard read: ' + str(error)); return
    if len(data) <= LIMIT and copy == copies[0]: emit(type='clipboard', text=data.decode('utf-8', 'replace'))
def transfer(connection, name, path, interface, signal, parameters):
    owner, kind, serial = parameters.unpack()
    if owner != session: return
    done = False
    try:
        with os.fdopen(portal_fd('SelectionWrite', '(ou)', serial), 'wb') as target:
            target.write(offered[0].encode('utf-8'))
        done = True
    except Exception as error:
        emit(type='warning', message='Clipboard write: ' + str(error))
    bus.call(NAME, PATH, CLIP, 'SelectionWriteDone', GLib.Variant('(oub)', (session, serial, done)), None, Gio.DBusCallFlags.NONE, -1, None, None, None)
if clipboard:
    bus.signal_subscribe(NAME, CLIP, 'SelectionOwnerChanged', PATH, None, Gio.DBusSignalFlags.NONE, owner_changed)
    bus.signal_subscribe(NAME, CLIP, 'SelectionTransfer', PATH, None, Gio.DBusSignalFlags.NONE, transfer)
def closed(*arguments):
    emit(type='closed'); loop.quit()
bus.signal_subscribe(NAME, 'org.freedesktop.portal.Session', 'Closed', session, None, Gio.DBusSignalFlags.NO_MATCH_RULE, closed)
if not closing:
    loop.run()
finish(0)
`;

// --- Keys and buttons ---

// X keysyms for the RobotJS key names input.cjs sends, since the portal takes keys as keysyms. Letters, digits and
// ASCII punctuation are their own code points, and the function keys are counted from F1 (see keysym()).
const KEYSYMS = Object.freeze({
  enter: 0xff0d,
  escape: 0xff1b,
  backspace: 0xff08,
  tab: 0xff09,
  space: 0x20,
  delete: 0xffff,
  home: 0xff50,
  end: 0xff57,
  pageup: 0xff55,
  pagedown: 0xff56,
  up: 0xff52,
  down: 0xff54,
  left: 0xff51,
  right: 0xff53,
  capslock: 0xffe5,
  insert: 0xff63,
  printscreen: 0xff61,
  shift: 0xffe1,
  right_shift: 0xffe2,
  control: 0xffe3,
  left_control: 0xffe3,
  right_control: 0xffe4,
  alt: 0xffe9,
  right_alt: 0xffea,
  command: 0xffeb,
});
// Linux evdev codes for RobotJS button names (BTN_LEFT, BTN_RIGHT, BTN_MIDDLE), which the portal takes.
const BUTTONS = Object.freeze({ left: 0x110, right: 0x111, middle: 0x112 });

/** The X keysym for a RobotJS key name, or null when there is none. */
function keysym(name) {
  if (typeof name !== 'string') return null;
  if (Object.hasOwn(KEYSYMS, name)) return KEYSYMS[name];
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(name)) return 0xffbe + Number(name.slice(1)) - 1;
  if (/^[a-z0-9\-=[\]\\;',./`]$/.test(name)) return name.charCodeAt(0);
  return null;
}

/**
 * The keysym that types one character of text: a newline as Enter, a tab as Tab, and printable ASCII as itself.
 * Anything else gives null, and typeString skips it.
 */
function textKeysym(character) {
  if (character === '\n') return KEYSYMS.enter;
  if (character === '\t') return KEYSYMS.tab;
  const code = character.codePointAt(0);
  return code >= 0x20 && code <= 0x7e ? code : null;
}

/** An error with the code input.cjs uses when native input can't be used. */
function unavailable(message) {
  return Object.assign(new Error(message), { code: 'INPUT_UNAVAILABLE' });
}

// --- The portal session ---

/**
 * Creates the portal connection. Nothing runs until start().
 *
 * Options:
 * - tokenFile: where the portal's restore token is kept, privately, between sessions.
 * - bounds: the shared display's bounds, or a function that returns them. Pointer positions from input.cjs are in
 *   the same coordinates.
 * - run: starts the helper (child_process.spawn; tests pass their own).
 * - onState(state, message): hears every change of state, with the helper's explanation when there is one.
 *
 * Returns {start, stop, robot, clipboard, state}. robot and clipboard are what input.cjs and main.cjs use, and state
 * is the current state.
 */
function createPortalInput({ tokenFile, bounds, run = spawn, onState = () => {} } = {}) {
  // child is the running helper, and stream the shared screen's position and size once the session is ready.
  // starting is the promise of the start() under way. clipboardText is the text last copied on this computer, as the
  // portal reported it, or the text last offered for pasting.
  let child = null,
    stream = null,
    state = 'off',
    starting = null,
    clipboardText = '';

  /** Records the state and tells onState. A listener that throws can't break input. */
  function setState(next, message = '') {
    state = next;
    try {
      onState(next, message);
    } catch {
      /* reporting must not break input */
    }
  }

  /** Sends one command to the helper. Throws INPUT_UNAVAILABLE until the session is allowed. */
  function send(command) {
    if (state !== 'allowed' || !child?.stdin.writable)
      throw unavailable('Remote control is waiting for approval on this computer.');
    child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  /**
   * Starts the helper and its portal session, and resolves with the state it reached: 'allowed', 'denied',
   * 'unavailable' or 'off'. A session that can't start resolves too, with the state that says why. While a helper
   * is starting or running, it returns the same promise.
   */
  function start() {
    if (starting) return starting;
    setState('asking');
    starting = new Promise((resolve) => {
      let helper;
      try {
        // -I runs Python isolated from the environment's PYTHON* settings and the current folder.
        helper = run('python3', ['-I', '-c', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
      } catch {
        setState('unavailable');
        starting = null;
        resolve(state);
        return;
      }
      child = helper;
      let buffer = '',
        settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve(state);
        }
      };
      // Writing to a helper that has gone fails; its 'exit' handles that, so the write error itself is dropped.
      helper.stdin.on('error', () => {});
      helper.stdout.setEncoding('utf8');
      // One message per line, which can arrive split anywhere. Lines that aren't JSON are skipped, and so are
      // messages from a helper that a newer one has replaced (child === helper fails then).
      helper.stdout.on('data', (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          // Approved. A 'ready' without a screen size is ignored. The approval's token is kept privately for next
          // time, marked as one that includes the clipboard.
          if (message.type === 'ready' && child === helper) {
            const { width, height, x = 0, y = 0 } = message.stream || {};
            if (!(width > 0 && height > 0)) continue;
            stream = { x, y, width, height };
            if (tokenFile && typeof message.token === 'string' && message.token)
              writePrivateJson(tokenFile, { token: message.token, clipboardAsked: true });
            setState('allowed');
            finish();
          } else if (message.type === 'error' && child === helper) {
            setState(message.reason === 'denied' ? 'denied' : 'unavailable', message.message || '');
            finish();
          } else if (
            message.type === 'clipboard' &&
            child === helper &&
            typeof message.text === 'string'
          ) {
            clipboardText = message.text;
          } else if (message.type === 'closed' && child === helper) {
            stream = null;
            setState('off');
          }
        }
      });
      // python3 couldn't be started (it isn't installed, for example).
      helper.on('error', () => {
        if (child === helper) {
          child = null;
          stream = null;
          setState('unavailable');
        }
        finish();
      });
      // The helper ended. A refusal or a failure keeps its state, so the page can say why; otherwise it's 'off'.
      helper.on('exit', () => {
        if (child === helper) {
          child = null;
          stream = null;
          if (state === 'allowed' || state === 'asking') setState('off');
        }
        starting = null;
        finish();
      });
      // An approval from before the session asked for the clipboard restores without it (GNOME keeps the clipboard
      // choice in the approval), so that one is set aside, and the desktop asks once more, clipboard included.
      // The token goes on stdin, never in the arguments, where other programs could read it, and only when it looks
      // like a token.
      const stored = tokenFile ? readJson(tokenFile, {}) : {},
        saved = stored.clipboardAsked === true ? stored.token : '';
      helper.stdin.write(
        `${typeof saved === 'string' && /^[\w-]{1,256}$/.test(saved) ? saved : ''}\n`,
      );
    });
    return starting;
  }

  /**
   * Ends the session. Closing the helper's stdin makes it close the portal session and exit; it is killed if it is
   * still running two seconds later.
   */
  function stop() {
    const helper = child;
    child = null;
    stream = null;
    starting = null;
    if (helper) {
      helper.stdin.end();
      setTimeout(() => helper.kill(), 2000).unref?.();
    }
    if (state !== 'off') setState('off');
  }

  /**
   * Positions arrive from input.cjs in the display's coordinates, and the portal wants them in the shared screen's:
   * each becomes a fraction of the display, kept inside it, and then a position in the stream.
   */
  function toStream(x, y) {
    const area = typeof bounds === 'function' ? bounds() : bounds;
    const fractionX = area ? (x - area.x) / Math.max(1, area.width - 1) : 0;
    const fractionY = area ? (y - area.y) / Math.max(1, area.height - 1) : 0;
    const clamp = (value) => Math.min(Math.max(value, 0), 1);
    return [clamp(fractionX) * (stream.width - 1), clamp(fractionY) * (stream.height - 1)];
  }

  // --- RobotJS's methods, as portal commands ---

  const robot = {
    // There is no shared screen to place the pointer in until the session is ready.
    moveMouse(x, y) {
      if (!stream) throw unavailable('Remote control is waiting for approval on this computer.');
      send({ m: toStream(x, y) });
    },
    // An unknown button name presses the left button.
    mouseToggle(direction = 'down', button = 'left') {
      send({ b: BUTTONS[button] ?? BUTTONS.left, d: direction === 'down' ? 1 : 0 });
    },
    // A click is a press and a release; a double click is two of them.
    mouseClick(button = 'left', double = false) {
      for (let i = 0; i < (double ? 2 : 1); i++) {
        this.mouseToggle('down', button);
        this.mouseToggle('up', button);
      }
    },
    // RobotJS counts positive steps up and left; the portal counts them down and right.
    scrollMouse(x, y) {
      if (y) send({ a: 0, s: -y });
      if (x) send({ a: 1, s: -x });
    },
    // Modifier flags aren't needed here: input.cjs passes them only on macOS.
    keyToggle(key, direction = 'down') {
      const code = keysym(key);
      if (code === null)
        throw Object.assign(new Error('This key is not supported.'), { code: 'UNSUPPORTED_KEY' });
      send({ k: code, d: direction === 'down' ? 1 : 0 });
    },
    // Text is typed one key at a time, by keysym.
    typeString(text) {
      for (const character of String(text)) {
        const code = textKeysym(character);
        if (code === null) continue;
        send({ k: code, d: 1 });
        send({ k: code, d: 0 });
      }
    },
  };

  // --- The clipboard ---

  // This computer's clipboard through the portal, for the shared clipboard: readText() gives the text last copied
  // here, as the portal reported it, and writeText() offers text for pasting here.
  const clipboard = {
    readText() {
      return clipboardText;
    },
    writeText(text) {
      clipboardText = String(text);
      send({ clip: clipboardText });
    },
  };

  return {
    start,
    stop,
    robot,
    clipboard,
    get state() {
      return state;
    },
  };
}

module.exports = { createPortalInput, keysym, HELPER };
