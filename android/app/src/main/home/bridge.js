'use strict';
// The Android app's home screen (home.html): the desktop app's list of computers (src/windows/host/) on a touch
// screen, with the controls for general mode, where this device shares its own screen. The page does no network
// work itself. Java (MainActivity's HomeBridge) does it: discovery, certificate checks, sign-in, the remembered
// passwords, and general mode's sharing. Once a sign-in gives a ticket, Java opens the viewer.
//
// home.html loads its scripts in this order, as classic scripts that share one global scope: bridge.js, common.js,
// night-and-day.js, devices.js, connecting.js, general-mode.js, settings.js and start.js. All of them but start.js
// only declare state and functions; start.js, last, connects them to the page and starts the screen.
//
// This file is the bridge to Java. The page calls window.YesMachineHome.request(id, method, json); Java answers
// through window.__homeReply(id, ok, value), and pushes updates through window.__homeEvent({ kind, value }), where
// kind is 'discovery', 'event' or 'control'. `api` wraps both as promises and handlers.

const native = window.YesMachineHome;
const waiting = new Map();
let nextCall = 1;

/** Asks Java for something: resolves with its answer, or rejects with its error message (and status, if any). */
const call = (method, args = {}) =>
  new Promise((resolve, reject) => {
    const id = String(nextCall++);
    waiting.set(id, { resolve, reject });
    native.request(id, method, JSON.stringify(args));
  });
// The page's handlers for each kind of update Java pushes.
const handlers = { discovery: [], event: [], control: [] };

/** Every request the page makes of Java, and the handlers for what Java pushes. */
const api = {
  info: () => call('info'),
  probe: (targets) => call('probe', { targets }),
  refreshDiscovery: () => call('refresh'),
  inspect: (target) => call('inspect', target),
  trust: (target) => call('trust', target),
  signIn: (target, credential, name) => call('signIn', { ...target, ...credential, name }),
  signInSaved: (target, name) => call('signInSaved', { ...target, name }),
  // Settings' lists, and forgetting the entries checked there by their keys.
  trustedList: () => call('trustedList'),
  forgetTrusted: (keys) => call('forgetTrusted', { keys }),
  credentialsInfo: () => call('credentialsInfo'),
  forgetCredentials: (keys) => call('forgetCredentials', { keys }),
  control: () => call('control'),
  setMode: (mode) => call('setMode', { mode }),
  openAccessibility: () => call('openAccessibility'),
  openDeveloperOptions: () => call('openDeveloperOptions'),
  startSharing: () => call('startSharing'),
  stopSharing: () => call('stopSharing'),
  disconnectComputer: () => call('disconnectComputer'),
  answer: (id, allow, always) => call('answer', { id, allow, always }),
  allowedList: () => call('allowedList'),
  forgetComputers: (keys) => call('forgetComputers', { keys }),
  setTheme: (mode) => call('setTheme', { mode }),
  onDiscovery: (handler) => handlers.discovery.push(handler),
  onEvent: (handler) => handlers.event.push(handler),
  onControl: (handler) => handlers.control.push(handler),
};

/** Lets Java answer requests and push updates. Called first by start.js. */
function setUpBridge() {
  window.__homeReply = (id, ok, value) => {
    const call = waiting.get(id);
    if (!call) return;
    waiting.delete(id);
    if (ok) call.resolve(value);
    else
      call.reject(
        Object.assign(Error(value?.error || 'Something went wrong. Try again.'), {
          status: value?.status,
        }),
      );
  };
  window.__homeEvent = (event) => {
    for (const handler of handlers[event?.kind] || []) handler(event.value);
  };
}
