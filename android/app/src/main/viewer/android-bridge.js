'use strict';
// Connects the viewer page in the Android app to the app's Java code. The app bundles the same,
// unchanged browser viewer as the web (public/client.html and its scripts in public/client/), and
// its build adds this script just before them (android/app/build.gradle), so this one runs first.
//
// Java does the network side. Native code picks the computer, pins its certificate and signs in,
// then opens the page with a one-time ticket, so the page never asks for a PIN. MainActivity
// attaches a NativeSession (NativeSession.java) as window.YesMachineNative, and only to the app's
// own bundled page, served from https://appassets.androidplatform.net. This script:
//  - stops at once anywhere else;
//  - replaces window.WebSocket with LocalSocket, which accepts only the session's URL and carries
//    its text messages through Java, which holds the real, pinned connection;
//  - receives Java's socket events through window.__yesMachineSocketEvent(id, type, value), and
//    its notices through window.__yesMachineNotice(text);
//  - replaces navigator.clipboard with Android's clipboard, read and written through Java.
(() => {
  const native = window.YesMachineNative;
  if (!native || location.origin !== 'https://appassets.androidplatform.net')
    throw new Error('Native viewer origin mismatch.');

  // --- WebSocket over Java ---

  let nextId = 1;
  const sockets = new Map(); // id -> its LocalSocket, until it closes
  /**
   * A WebSocket look-alike for the viewer (client/session.js). Each socket gets an id that Java uses in its events, and
   * opening one replaces the previous connection on the Java side. Only text messages go through.
   */
  class LocalSocket extends EventTarget {
    // The readyState values, as on WebSocket, since the viewer compares with WebSocket.OPEN.
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    /** Accepts only wss://appassets.androidplatform.net/session, and asks Java to connect. */
    constructor(url) {
      super();
      const parsed = new URL(String(url));
      if (parsed.href !== 'wss://appassets.androidplatform.net/session')
        throw new Error('Only the selected Yes Machine session is allowed.');
      this.id = nextId++;
      this.readyState = 0;
      this.url = parsed.href;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      sockets.set(this.id, this);
      native.open(this.id);
    }
    /** The bytes Java still has queued to send, like WebSocket's bufferedAmount. */
    get bufferedAmount() {
      return native.queued(this.id);
    }
    /**
     * Sends a text message. Throws when the socket isn't open or when Java turns the message down:
     * NativeSession accepts only the message types the viewer sends, up to 100,000 bytes, and only
     * while no more than 2 MB is waiting to go.
     */
    send(value) {
      if (this.readyState !== 1 || typeof value !== 'string' || !native.send(this.id, value))
        throw new Error('The native connection is unavailable or busy.');
    }
    /** Closes the connection. No close event follows: the socket is forgotten at once. */
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      native.close(this.id);
      sockets.delete(this.id);
    }
  }
  window.WebSocket = LocalSocket;
  /**
   * Called by Java for each event on a socket: type is 'open', 'message' (value is the message's
   * text), 'error' or 'close' (value is the reason). Events for a socket that is gone are dropped.
   */
  window.__yesMachineSocketEvent = (id, type, value) => {
    const socket = sockets.get(id);
    if (!socket) return;
    if (type === 'open') socket.readyState = 1;
    if (type === 'close') {
      socket.readyState = 3;
      sockets.delete(id);
    }
    const event =
      type === 'message'
        ? new MessageEvent(type, { data: value })
        : type === 'close'
          ? new CloseEvent(type, { code: 1000, reason: value })
          : new Event(type);
    // Listeners first, then the on<type> property, which EventTarget doesn't call by itself.
    socket.dispatchEvent(event);
    const handler = socket['on' + type];
    if (typeof handler === 'function') handler.call(socket, event);
  };

  // --- Notices ---

  /**
   * Called by Java to tell the person something, such as how a file transfer went: the text goes
   * in the viewer's notice bar (up to 600 characters) and in its file status line.
   */
  window.__yesMachineNotice = (text) => {
    const notice = document.getElementById('notice'),
      label = document.getElementById('notice-text');
    if (notice && label) {
      label.textContent = String(text).slice(0, 600);
      notice.hidden = false;
    }
    const file = document.getElementById('file-status');
    if (file) file.textContent = text;
  };

  // --- Clipboard ---

  // The shared clipboard (client/clipboard.js) may read this clipboard without asking, unlike a browser's.
  // Before reading, it asks Java whether anything new was copied since it last looked, so Android's
  // clipboard is read only when there is something new.
  window.__yesMachineNativeClipboard = true;
  window.__yesMachineClipboardChanged = () => native.clipboardChanged();
  // Java writes at most 60,000 bytes of text, and returns false for more.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: async () => native.readClipboard(),
      writeText: async (text) => {
        if (!native.writeClipboard(String(text))) throw new Error('Clipboard text exceeds 60 KB.');
      },
    },
  });
})();
