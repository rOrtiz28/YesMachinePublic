'use strict';

// Tests the viewer windows for Android devices (src/main/android/windows.cjs): what Disconnect does, a connection
// canceled while the person at the device is being asked, and the shared clipboard with a device. Electron is a
// stand-in, put in Node's module cache before windows.cjs loads it. The sessions with devices are stand-ins too,
// but the bytes the tests send through them are real stream messages.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// Stand-ins for Electron's windows and messages, put in place before windows.cjs loads them. Every window is kept
// in `windows`, and every IPC handler in `handlers`, so a test can call one as the page would.
const handlers = new Map(),
  windows = [];
// A BrowserWindow that records its options and can be closed; its webContents does nothing.
class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.webContents = { send() {}, on() {}, setWindowOpenHandler() {} };
    windows.push(this);
  }
  loadFile() {
    return Promise.resolve();
  }
  removeMenu() {}
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}
require.cache[require.resolve('electron')] = {
  exports: {
    app: { getPath: () => '/tmp' },
    shell: {},
    BrowserWindow: FakeWindow,
    ipcMain: {
      on: (name, handler) => handlers.set(name, handler),
      handle: (name, handler) => handlers.set(name, handler),
    },
  },
};
const { createAndroidViewers } = require('../../src/main/android/windows.cjs');

/**
 * A session with a device called `name`: its socket is an event emitter that writes nowhere, and closing the
 * session is recorded.
 */
function fakeSession(name) {
  const socket = new EventEmitter();
  Object.assign(socket, { destroyed: false, resume() {}, write() {} });
  return {
    socket,
    device: { name },
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

test('Disconnect closes the Android window, ends its session and tells the main window, as for a computer', async () => {
  handlers.clear();
  windows.length = 0;
  const ended = [],
    session = fakeSession('Alejandro’s Tab A11+');
  const viewers = createAndroidViewers({
    android: {
      devices: () => [
        { id: 'R5', name: 'Alejandro’s Tab A11+', transport: 'usb', connections: { usb: true } },
      ],
      connect: async () => session,
    },
    share: { devices: () => [] },
    backgroundColor: () => '#eef2f5',
    onEnded: (details) => ended.push(details),
  });
  await viewers.open('R5', 'usb');
  const [window] = windows;
  assert.equal(
    window.options.backgroundColor,
    '#eef2f5',
    'the window opens in the app’s current colors',
  );
  assert.deepEqual(viewers.connected(), ['R5']);
  handlers.get('android-disconnect')({ sender: window.webContents });
  assert.equal(window.isDestroyed(), true);
  assert.equal(session.closed, true);
  assert.deepEqual(ended, [{ name: 'Alejandro’s Tab A11+', general: false, reason: 'closed' }]);
  assert.deepEqual(viewers.connected(), []);
  session.socket.emit('close');
  assert.equal(ended.length, 1, 'the session closing afterwards says nothing more');
});

test('Disconnect while the person at the device is still being asked says it disconnected, without a cancel error', async () => {
  handlers.clear();
  windows.length = 0;
  const ended = [];
  const viewers = createAndroidViewers({
    android: { devices: () => [] },
    share: {
      devices: () => [{ id: 'tab', name: 'Tablet' }],
      connect: (_id, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('Canceled.'))),
        ),
    },
    onEnded: (details) => ended.push(details),
  });
  const opening = viewers.open('tab', 'network');
  await new Promise((resolve) => setImmediate(resolve));
  handlers.get('android-disconnect')({ sender: windows[0].webContents });
  await opening;
  assert.deepEqual(ended, [{ name: 'Tablet', general: true, reason: 'closed' }]);
});

test('closing the window itself while asked still reports the cancel, as before', async () => {
  handlers.clear();
  windows.length = 0;
  const viewers = createAndroidViewers({
    android: { devices: () => [] },
    share: {
      devices: () => [{ id: 'tab', name: 'Tablet' }],
      connect: (_id, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('Canceled.'))),
        ),
    },
  });
  const opening = viewers.open('tab', 'network');
  await new Promise((resolve) => setImmediate(resolve));
  windows[0].close();
  await assert.rejects(opening, /Canceled/);
});

// A session whose socket records what the computer writes to the device. The device's side is sent by the test:
// the stream's header, then its messages.
function talkingSession(name) {
  const session = fakeSession(name),
    written = [];
  session.socket.write = (bytes) => {
    written.push(Buffer.from(bytes));
    return true;
  };
  return { session, written };
}
// The header a device's stream starts with: "YMS1", a 1920 × 1200 screen, and the encoder's name, "avc".
const HEADER = (() => {
  const bytes = Buffer.alloc(19);
  bytes.write('YMS1', 0, 'latin1');
  bytes.writeInt32BE(1920, 4);
  bytes.writeInt32BE(1200, 8);
  bytes.writeInt32BE(3, 12);
  bytes.write('avc', 16);
  return bytes;
})();
// The device's message for text copied there: type 7, the text's length, then the text in UTF-8.
const copiedOnDevice = (text) => {
  const bytes = Buffer.from(text, 'utf8'),
    message = Buffer.alloc(5 + bytes.length);
  message[0] = 7;
  message.writeInt32BE(bytes.length, 1);
  bytes.copy(message, 5);
  return message;
};

test('the clipboard goes both ways with a device, as the clipboard card allows', async () => {
  handlers.clear();
  windows.length = 0;
  const { session, written } = talkingSession('Alejandro’s Tab A11+');
  let here = 'already copied before';
  const writes = [];
  const viewers = createAndroidViewers({
    android: {
      devices: () => [
        { id: 'R5', name: 'Alejandro’s Tab A11+', transport: 'usb', connections: { usb: true } },
      ],
      connect: async () => session,
    },
    share: { devices: () => [] },
    clipboard: {
      readText: () => here,
      writeText: (text) => {
        writes.push(text);
        here = text;
      },
    },
  });
  await viewers.open('R5', 'usb');
  const sender = windows[0].webContents;
  handlers.get('android-clipboard')({ sender }, { on: true, way: 'both' });
  assert.deepEqual([...written.at(-1)], [11, 1], 'the device reports its copies');

  session.socket.emit('data', Buffer.concat([HEADER, copiedOnDevice('copiado en la tableta')]));
  assert.deepEqual(
    writes,
    ['copiado en la tableta'],
    'what the device copied is ready to paste here',
  );

  // The computer's clipboard is read twice a second, and its text goes to the device as type 10 messages.
  here = 'copied on the computer';
  await new Promise((resolve) => setTimeout(resolve, 700));
  const sent = written
    .filter((bytes) => bytes[0] === 10)
    .map((bytes) => bytes.subarray(5).toString('utf8'));
  assert.deepEqual(
    sent,
    ['copied on the computer'],
    'only what was copied here since, and not the device’s own text back',
  );

  handlers.get('android-clipboard')({ sender }, { on: true, way: 'from' });
  assert.deepEqual(
    [...written.at(-1)],
    [11, 0],
    'only from this computer: the device stops reporting',
  );
  session.socket.emit('data', copiedOnDevice('ignored'));
  assert.deepEqual(writes, ['copiado en la tableta']);

  handlers.get('android-clipboard')({ sender }, { on: false, way: 'both' });
  here = 'not sent while off';
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(written.filter((bytes) => bytes[0] === 10).length, 1);
  windows[0].close();
});
