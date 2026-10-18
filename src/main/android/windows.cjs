'use strict';
// Viewer windows for Android devices: one per device, in advanced mode (advanced-mode.cjs) or general mode
// (general-mode.cjs). Each window gets the device's stream from its session and sends touches, scrolls and keys back,
// checked here before they reach the device. Like the computer viewers, a window whose session ends on its own closes,
// and the main window says why. Files go both ways over a second connection to the device (files.cjs), and the
// clipboard is shared as the clipboard card in Settings allows.
//
// main.cjs creates this once. Each window loads src/windows/android/viewer.html with src/preload/android.cjs, and
// talks to this file over IPC. From the page: android-input, android-clipboard, android-send-files, android-show-file,
// android-screenshot, android-show-screenshot and android-disconnect. To the page, on android-stream: the device
// ('device'), the device asking its person ('asking'), the stream's messages (protocol.cjs), and the files' progress
// ('file', 'files-ready', 'files-unavailable').
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const { statSync } = require('node:fs');
const path = require('node:path');
const { createParser, encodeInput, fileHello, CLIPBOARD_LIMIT } = require('./protocol.cjs');
const { createFileChannel } = require('./files.cjs');
const { createClipboardWatch } = require('../control/clipboard-watch.cjs');

/**
 * A screenshot the viewer page made from its own picture of the screen, when the device can't take one itself.
 * Returns the PNG as a Buffer over the same memory, or null unless it is a PNG of at most 64 MB.
 */
function checkedPicture(value) {
  if (!(value instanceof Uint8Array) || value.length < 8 || value.length > 64 * 1024 * 1024)
    return null;
  const png = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return png.readUInt32BE(0) === 0x89504e47 ? png : null;
}

/**
 * Creates the Android viewer windows and registers their IPC handlers.
 *
 * Options:
 * - android: advanced mode (advanced-mode.cjs), and share: general mode (general-mode.cjs).
 * - icon: the windows' icon.
 * - backgroundColor() gives the color a new window shows before its page draws, night or day.
 * - onConnected(ids) hears the ids of the devices with a window, whenever they change.
 * - onEnded({name, general, reason}) hears when a session ends with Disconnect or on its own, so the main window can
 *   say why (closing the window isn't reported): reason is 'closed' after Disconnect, 'general' or 'other' when the
 *   device ended it (see protocol.cjs), and undefined when the connection broke or the stream didn't parse.
 * - clipboard is this computer's (readText and writeText), or null for no shared clipboard.
 * - computer is how this computer introduces itself to a device's file connection ({name, system}).
 * - filesFolder() gives the private folder where files from devices arrive.
 *
 * Returns {open, connected, owns}.
 */
function createAndroidViewers({
  android,
  share,
  icon,
  backgroundColor = () => '#0d1115',
  onConnected = () => {},
  onEnded = () => {},
  clipboard = null,
  computer = { name: 'A computer', system: '' },
  filesFolder = () => path.join(app.getPath('userData'), 'private-network', 'android-files'),
}) {
  // device id -> { window, session, general, clipboard, files, saved }, plus the device's name, the last screenshot's
  // path, why the device ended the session, and whether Disconnect was pressed.
  const windows = new Map();
  const connected = () => [...windows.keys()];

  // --- Input from the window ---

  // The [id, entry] of the window an IPC message came from. Messages from anything else find none and are ignored.
  const owner = (sender) =>
    [...windows.entries()].find(([, each]) => each.window.webContents === sender);
  // Sends a message to the window's page.
  const tell = (entry, message) => {
    if (!entry.window.isDestroyed()) entry.window.webContents.send('android-stream', message);
  };
  // Encodes an input message for the device (protocol.cjs) and sends it. One that isn't valid is dropped.
  const write = (entry, message) => {
    const bytes = entry?.session ? encodeInput(message) : null;
    if (bytes && !entry.session.socket.destroyed) entry.session.socket.write(bytes);
  };
  ipcMain.on('android-input', (event, message) => write(owner(event.sender)?.[1], message));

  // --- The shared clipboard ---

  // Each window says what the clipboard card says, as it can read it and hears it change: off, or which way. 'from'
  // this computer lets what is copied here go to the device; 'to' it lets the device's copies land here, and 'both'
  // does both. The device reports its copies only while that's allowed.
  const allows = (entry, way) =>
    entry.clipboard.on && (entry.clipboard.way === 'both' || entry.clipboard.way === way);
  // One watch of this computer's clipboard for every window: what is copied here goes to each device that may have
  // it, unless it is longer than the protocol takes.
  const watch =
    clipboard &&
    createClipboardWatch({
      clipboard,
      onChange: (text) => {
        if (Buffer.byteLength(text) > CLIPBOARD_LIMIT) return;
        for (const entry of windows.values())
          if (entry.session && allows(entry, 'from')) write(entry, { type: 'clipboard', text });
      },
    });
  /**
   * Applies the clipboard settings: tells the window's device whether to report its copies (entry can be null), and
   * keeps the watch running only while some window takes this computer's copies.
   */
  function syncClipboard(entry) {
    if (entry?.session) write(entry, { type: 'clipboard-report', on: allows(entry, 'to') });
    if (!watch) return;
    if ([...windows.values()].some((each) => each.session && allows(each, 'from'))) watch.start();
    else watch.stop();
  }
  // A window's clipboard setting, {on, way}. A way it doesn't know means both.
  ipcMain.on('android-clipboard', (event, mode) => {
    const entry = owner(event.sender)?.[1];
    if (!entry || !mode || typeof mode !== 'object') return;
    entry.clipboard = {
      on: mode.on === true,
      way: ['to', 'both', 'from'].includes(mode.way) ? mode.way : 'both',
    };
    syncClipboard(entry);
  });
  /** Text copied on the device lands on this computer's clipboard when allowed, noted first so it isn't sent back. */
  function copied(entry, text) {
    if (!clipboard || !allows(entry, 'to') || !text) return;
    watch?.note(text);
    try {
      clipboard.writeText(text);
    } catch {
      /* the clipboard stays as it was */
    }
  }

  // --- Files ---

  // Files: dropped on the window or chosen in it, from their place on disk; the page names them with Electron's own
  // paths for the files it was given. A list of more than 100 is ignored, and only absolute paths of existing files
  // are taken. Files from the device are saved where the person here chooses.
  ipcMain.on('android-send-files', (event, list) => {
    const entry = owner(event.sender)?.[1];
    if (!entry || !Array.isArray(list) || list.length > 100) return;
    const files = list
      .filter(
        (file) =>
          file &&
          typeof file.path === 'string' &&
          path.isAbsolute(file.path) &&
          (() => {
            try {
              return statSync(file.path).isFile();
            } catch {
              return false;
            }
          })(),
      )
      .map((file) => ({
        path: file.path,
        name: typeof file.name === 'string' ? file.name : path.basename(file.path),
        size: Number(file.size) || 0,
      }));
    if (!files.length) return;
    // Without a file connection, the page hears that files can't go now.
    if (!entry.files) {
      tell(entry, { type: 'files-unavailable' });
      return;
    }
    entry.files.send(files);
  });
  // Shows a saved file in its folder.
  ipcMain.on('android-show-file', (event, id) => {
    const file = owner(event.sender)?.[1]?.saved.get(id);
    if (file) shell.showItemInFolder(file);
  });
  /**
   * A file from the device: asks where to save it, moves it there and tells the page how it went (saved, with its
   * name and folder; not-saved; or failed).
   */
  async function keep(entry, file) {
    const report = (state, extra = {}) =>
      tell(entry, {
        type: 'file',
        direction: 'in',
        id: file.id,
        name: file.name,
        size: file.size,
        done: file.size,
        state,
        ...extra,
      });
    if (entry.window.isDestroyed()) return;
    try {
      const choice = await dialog.showSaveDialog(entry.window, {
        title: `Save the file from ${entry.name}`,
        defaultPath: path.join(app.getPath('downloads'), file.name),
        buttonLabel: 'Save file',
      });
      if (choice.canceled || !choice.filePath) {
        report('not-saved');
        return;
      }
      // Moved rather than copied, so a large file doesn't take twice the room or time; a copy only across disks.
      await fs.rename(file.path, choice.filePath).catch((error) => {
        if (error.code !== 'EXDEV') throw error;
        return fs.copyFile(file.path, choice.filePath);
      });
      entry.saved.set(file.id, choice.filePath);
      report('saved', {
        detail: path.basename(choice.filePath),
        folder: path.basename(path.dirname(choice.filePath)),
      });
    } catch (error) {
      report('failed', { detail: error.message });
    }
  }
  /**
   * Opens the session's file connection, introduces this computer on it and runs a file channel there. The page hears
   * files-ready, or files-unavailable when there is no connection or it closes.
   */
  async function openFiles(entry) {
    let socket;
    try {
      socket = await entry.session.openFiles();
    } catch {
      tell(entry, { type: 'files-unavailable' });
      return;
    }
    // The window may have closed while the connection was opening.
    if (entry.window.isDestroyed()) {
      socket.destroy();
      return;
    }
    socket.write(fileHello(computer.name, computer.system));
    const files = createFileChannel({
      socket,
      directory: filesFolder(),
      onEvent: (event) => tell(entry, event),
      onReceived: (file) => keep(entry, file),
    });
    entry.files = files;
    socket.once('close', () => {
      if (entry.files === files) {
        entry.files = null;
        tell(entry, { type: 'files-unavailable' });
      }
    });
    tell(entry, { type: 'files-ready' });
  }

  // --- Screenshots and Disconnect ---

  // Screenshots go to Pictures/Yes Machine, named after the device and the time, as a Mac names its own. In general
  // mode the page sends its picture of the screen; adb takes a sharper one in advanced mode. Characters a file name
  // can't have become "-", and a name already taken gets (2), (3) and so on.
  ipcMain.handle('android-screenshot', async (event, picture) => {
    const [id, entry] = owner(event.sender) || [];
    if (!entry?.session) throw Error('The device is not connected.');
    const png = entry.general ? checkedPicture(picture) : await android.screenshot(id);
    if (!png) throw Error('There was no picture to save.');
    const folder = path.join(app.getPath('pictures'), 'Yes Machine');
    await fs.mkdir(folder, { recursive: true });
    const now = new Date(),
      two = (value) => String(value).padStart(2, '0');
    const base = `${entry.session.device.name.replace(/[\\/:*?"<>|]/g, '-')} ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} at ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
    let file = path.join(folder, `${base}.png`);
    for (
      let copy = 2;
      await fs.access(file).then(
        () => true,
        () => false,
      );
      copy++
    )
      file = path.join(folder, `${base} (${copy}).png`);
    await fs.writeFile(file, png);
    entry.screenshot = file;
    return { folder: 'Pictures › Yes Machine' };
  });
  // Shows the last screenshot in its folder.
  ipcMain.on('android-show-screenshot', (event) => {
    const entry = owner(event.sender)?.[1];
    if (entry?.screenshot) shell.showItemInFolder(entry.screenshot);
  });
  // Disconnect, from the window's bar: the window closes, which ends the session, and the main window says so.
  ipcMain.on('android-disconnect', (event) => {
    const entry = owner(event.sender)?.[1];
    if (!entry || entry.window.isDestroyed()) return;
    entry.disconnected = true;
    entry.window.close();
    onEnded({ name: entry.name, general: entry.general, reason: 'closed' });
  });

  // --- Opening a device's window ---

  /**
   * Opens the device's window: in advanced mode over the cable or Wi-Fi, as asked when the device has both, and in
   * general mode over the network, once the person at the device allows this computer. transport is 'usb' or 'wifi'
   * for advanced mode, or 'network' for general mode. A window that is already open comes forward instead.
   *
   * In order: the window opens and loads its page, the page hears which device it shows, the session connects (in
   * general mode the page shows the device asking its person meanwhile), and then the stream flows to the page, the
   * clipboard settings apply and the file connection opens. Rejects when the device is gone, or when connecting fails
   * (the window closes then), unless Disconnect was pressed meanwhile.
   */
  async function open(id, transport) {
    const existing = windows.get(id);
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }
    const general = transport === 'network';
    const device = (general ? share.devices() : android.devices()).find((entry) => entry.id === id);
    if (!device)
      throw Error(general ? 'That device stopped sharing.' : 'That device is no longer connected.');
    const window = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 480,
      minHeight: 420,
      title: `${device.name} · Yes Machine`,
      backgroundColor: backgroundColor(),
      icon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../../preload/android.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    // Without a menu, Alt on Windows and Linux reaches the device instead of showing a menu bar.
    if (process.platform !== 'darwin') window.removeMenu();
    // cancel stops a general-mode connection that is still waiting for the device when the window closes.
    const entry = {
        window,
        session: null,
        general,
        name: device.name,
        clipboard: { on: true, way: 'both' },
        files: null,
        saved: new Map(),
      },
      cancel = new AbortController();
    windows.set(id, entry);
    onConnected(connected());
    // However the window closes, its session and file connection end with it.
    window.on('closed', () => {
      cancel.abort();
      const files = entry.files;
      entry.files = null;
      files?.close();
      entry.session?.close();
      if (windows.get(id) === entry) windows.delete(id);
      syncClipboard(null);
      onConnected(connected());
    });
    // The page can't open other windows or navigate away.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    const send = (message) => {
      if (!window.isDestroyed()) window.webContents.send('android-stream', message);
    };
    // The session ended on its own: the window closes, and the main window hears why.
    const end = () => {
      if (window.isDestroyed()) return;
      window.close();
      onEnded({ name: device.name, general, reason: entry.ended });
    };
    // A failed load isn't an error here; a window that closed while loading is caught by the check below.
    await window
      .loadFile(path.join(__dirname, '../../windows/android/viewer.html'))
      .catch(() => {});
    if (window.isDestroyed()) return;
    // The way this session goes: the network in general mode; otherwise the transport asked for, when the device has
    // it, or the device's default.
    const via = general
      ? 'network'
      : device.connections?.[transport]
        ? transport
        : device.transport;
    send({ type: 'device', name: device.name, system: device.system || 'Android', transport: via });
    try {
      entry.session = general
        ? await share.connect(id, {
            onAsking: () => send({ type: 'asking' }),
            signal: cancel.signal,
          })
        : await android.connect(id, via);
    } catch (error) {
      if (!window.isDestroyed()) window.close();
      if (entry.disconnected) return; // Disconnect, pressed while connecting, has already told the main window
      throw error;
    }
    if (window.isDestroyed()) {
      entry.session.close();
      return;
    }
    // The stream: 'ended' notes why the device ends the session (the connection closes next), 'clipboard' lands on
    // this computer's clipboard, and everything else goes to the page. A stream that doesn't parse ends the session.
    const parse = createParser((message) => {
      if (message.type === 'ended') entry.ended = message.reason;
      else if (message.type === 'clipboard') copied(entry, message.text);
      else send(message);
    });
    entry.session.socket.on('data', (chunk) => {
      try {
        parse(chunk);
      } catch {
        end();
      }
    });
    entry.session.socket.on('close', end);
    entry.session.socket.resume(); // general mode's socket waits, paused, with the stream's first bytes
    syncClipboard(entry);
    if (entry.session.openFiles) openFiles(entry);
  }

  // Whether these web contents belong to one of these windows, which may go full screen.
  const owns = (contents) =>
    [...windows.values()].some((each) => each.window.webContents === contents);

  return { open, connected, owns };
}

module.exports = { createAndroidViewers, checkedPicture };
