'use strict';
// Tests the script that connects the viewer page in the Android app to the app's Java code
// (android/app/src/main/viewer/android-bridge.js). The script runs in a separate Node context (node:vm) whose globals
// stand in for the page: its origin, minimal DOM events, and a YesMachineNative object that records what the script
// asks Java to do. Java's side is played by the tests, which call the script's event entry points directly.
// It is not part of npm test: run it with `node --test android/test/bridge.test.cjs`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(
  path.join(__dirname, '../app/src/main/viewer/android-bridge.js'),
  'utf8',
);

/**
 * Runs the bridge script in a new context whose page is at `origin` (by default the app's own bundled origin).
 * Returns the context's globals (`environment`), the calls the script made to Java (`calls`, in order), and the
 * stand-in Java object (`native`), which a test may change.
 */
function fixture(origin = 'https://appassets.androidplatform.net') {
  const calls = [];
  // Just enough of the DOM's events for the script: one listener per event type.
  class Event {
    constructor(type, values = {}) {
      this.type = type;
      Object.assign(this, values);
    }
  }
  class EventTarget {
    constructor() {
      this.listeners = new Map();
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
    dispatchEvent(event) {
      this.listeners.get(event.type)?.(event);
    }
  }
  // Stands in for the YesMachineNative object MainActivity gives the page (NativeSession.java). Every call is
  // recorded; 20 bytes are always waiting to be sent, and the clipboard holds "hello".
  const native = {
    open: (id) => calls.push(['open', id]),
    close: (id) => calls.push(['close', id]),
    send: (id, value) => {
      calls.push(['send', id, value]);
      return true;
    },
    queued: () => 20,
    readClipboard: () => {
      calls.push(['clipboard-read']);
      return 'hello';
    },
    writeClipboard: (text) => {
      calls.push(['clipboard-write', text]);
      return true;
    },
  };
  const environment = {
    location: { origin },
    navigator: {},
    URL,
    EventTarget,
    Event,
    MessageEvent: Event,
    CloseEvent: Event,
    document: {},
    addEventListener: () => {},
    YesMachineNative: native,
  };
  environment.window = environment;
  vm.runInNewContext(source, environment);
  return { environment, calls, native };
}

test('bridge starts without opening sockets or reading clipboard', () => {
  const { calls } = fixture();
  assert.deepEqual(calls, []);
  assert.throws(() => fixture('https://remote.example'), /origin mismatch/);
});

test('WebSocket shim accepts only the fixed bundled-origin session URL', () => {
  const { environment, calls } = fixture();
  for (const value of [
    'wss://8.8.8.8/session',
    'wss://192.168.1.2/session',
    'wss://appassets.androidplatform.net/session?x=1',
    'ws://appassets.androidplatform.net/session',
  ]) {
    assert.throws(() => new environment.WebSocket(value), /selected Yes Machine/);
  }
  const socket = new environment.WebSocket('wss://appassets.androidplatform.net/session');
  assert.deepEqual(calls, [['open', 1]]);
  assert.throws(() => socket.send('test'), /unavailable/);
  environment.__yesMachineSocketEvent(1, 'open', '');
  socket.send('{"type":"pair","code":"000000"}');
  assert.equal(socket.bufferedAmount, 20);
  assert.equal(socket.readyState, environment.WebSocket.OPEN);
  assert.deepEqual(calls.at(-1), ['send', 1, '{"type":"pair","code":"000000"}']);
});

test('native socket events preserve exact data and isolate stale session IDs', () => {
  const { environment, calls } = fixture();
  const socket = new environment.WebSocket('wss://appassets.androidplatform.net/session');
  const delivered = [];
  socket.onmessage = (event) => delivered.push(event.data);
  environment.__yesMachineSocketEvent(999, 'message', 'ignore');
  environment.__yesMachineSocketEvent(1, 'message', '"<script>not executable</script>"');
  socket.close();
  environment.__yesMachineSocketEvent(1, 'message', 'ignore after close');
  assert.deepEqual(delivered, ['"<script>not executable</script>"']);
  assert.equal(socket.readyState, environment.WebSocket.CLOSED);
  assert.deepEqual(calls.at(-1), ['close', 1]);
});

test('clipboard bridge runs only when explicitly invoked and reports write failure', async () => {
  const { environment, calls, native } = fixture();
  assert.equal(await environment.navigator.clipboard.readText(), 'hello');
  await environment.navigator.clipboard.writeText('¡Hola! 👋');
  assert.deepEqual(calls, [['clipboard-read'], ['clipboard-write', '¡Hola! 👋']]);
  native.writeClipboard = () => false;
  await assert.rejects(environment.navigator.clipboard.writeText('large'), /exceeds 60 KB/);
});
