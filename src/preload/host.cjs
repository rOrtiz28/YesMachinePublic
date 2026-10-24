'use strict';
// The host window's bridge to the main process: the window's scripts (src/windows/host/) reach it
// as window.yesMachine. The window is sandboxed with context isolation, so these methods are all
// the page can do beyond an ordinary web page.
//
// Each method calls one IPC channel that main.cjs answers with handle(), which refuses calls from
// anything but this window's main frame, and resolves with the answer. The on... methods subscribe
// to messages main.cjs sends this window, and return a function that unsubscribes.
const { contextBridge, ipcRenderer } = require('electron');

/** A method that calls the IPC channel `name` with its arguments and resolves with the answer. */
const invoke =
  (name) =>
  (...args) =>
    ipcRenderer.invoke(name, ...args);

/**
 * A subscription to the IPC channel `name`: it calls `callback` with each message's value and
 * returns a function that stops listening. (Not the bridge's listen method below, which opens the
 * sharing server.)
 */
const listen = (name) => (callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(name, handler);
  return () => ipcRenderer.removeListener(name, handler);
};

contextBridge.exposeInMainWorld('yesMachine', {
  platform: process.platform,
  // The list of computers: whether each is sharing right now, and a new discovery scan.
  probe: invoke('probe'),
  refreshDiscovery: invoke('refresh-discovery'),
  // This computer: its name, account, networks, permissions and the devices around it.
  info: invoke('info'),
  // The screen to share, and the night or day theme.
  screens: invoke('screens'),
  chooseScreen: invoke('choose-screen'),
  setTheme: invoke('set-theme'),
  // Sharing this computer. start() begins, so the page may capture the screen; listen(address)
  // then opens the sharing server on that network, and stop() ends sharing. The rest serve the
  // viewer's session: its clipboard, WebRTC signaling, input, and files.
  watchClipboard: invoke('clipboard-watch'),
  start: invoke('start'),
  listen: invoke('listen'),
  stop: invoke('stop'),
  signal: invoke('signal'),
  input: invoke('input'),
  release: invoke('release'),
  disconnect: invoke('disconnect'),
  sendFile: invoke('send-file'),
  // Puts text, such as this computer's address, on the clipboard.
  copy: invoke('copy-address'),
  // Opening another computer or an Android device, after checking and approving its certificate,
  // and pairing Android devices over Wi-Fi.
  inspect: invoke('inspect'),
  focusViewer: invoke('focus-viewer'),
  openAndroid: invoke('android-open'),
  inspectAndroid: invoke('android-inspect'),
  trustAndroid: invoke('android-trust'),
  startAndroidPairing: invoke('android-pair-start'),
  stopAndroidPairing: invoke('android-pair-stop'),
  trust: invoke('trust'),
  signIn: invoke('sign-in'),
  signInSaved: invoke('sign-in-saved'),
  // Settings: approved certificates and remembered sign-ins.
  trustedList: invoke('trusted-list'),
  forgetTrusted: invoke('forget-trusted'),
  credentialsInfo: invoke('credentials-info'),
  forgetCredentials: invoke('forget-credentials'),
  // The system: macOS permissions, system sound on Linux, and starting at login.
  accessibility: invoke('accessibility'),
  screenSettings: invoke('screen-settings'),
  linuxAudio: invoke('linux-audio'),
  loginItem: invoke('login-item'),
  setLoginItem: invoke('set-login-item'),
  // Messages from the main process: the viewer's WebRTC signaling, news about sharing and devices,
  // the system sound captured on Linux, and the computers discovery found.
  onSignal: listen('signal'),
  onEvent: listen('host-event'),
  onAudio: listen('audio-pcm'),
  onDiscovery: listen('discovery'),
});
