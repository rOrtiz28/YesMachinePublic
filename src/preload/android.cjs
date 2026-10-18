'use strict';
// The Android viewer window's only bridge: the device's stream in; touches, scrolls, keys, the
// on-screen keyboard switch, screenshots, files, the clipboard setting and Disconnect out. Files go
// by the paths Electron gives the files the person dropped or chose here.
//
// src/windows/android/viewer.js reaches it as window.device, and src/main/android/windows.cjs,
// which opens these windows, answers on the same channels. Positions are fractions of the device's
// screen, from 0 to 1, and actions, key codes and modifier states are Android's own numbers.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('device', {
  platform: process.platform,
  // Every message about the device: its details, video and sound, files, and how the session goes.
  onStream: (callback) => {
    ipcRenderer.on('android-stream', (_event, message) => callback(message));
  },
  // action: 0 down, 1 up, 2 move.
  touch: (action, x, y) => ipcRenderer.send('android-input', { type: 'touch', action, x, y }),
  scroll: (x, y, horizontal, vertical) =>
    ipcRenderer.send('android-input', { type: 'scroll', x, y, horizontal, vertical }),
  // action: 0 down, 1 up; code is the Android key code and meta the modifier keys held.
  key: (action, code, meta) =>
    ipcRenderer.send('android-input', { type: 'key', action, code, meta }),
  text: (value) => ipcRenderer.send('android-input', { type: 'text', value }),
  // Shows or hides the device's on-screen keyboard.
  keyboard: (show) => ipcRenderer.send('android-input', { type: 'keyboard', show }),
  // Saves a screenshot and resolves with the folder it went to. In general mode `picture` is the
  // page's own picture of the screen; advanced mode takes one through adb instead.
  screenshot: (picture) => ipcRenderer.invoke('android-screenshot', picture),
  showScreenshot: () => ipcRenderer.send('android-show-screenshot'),
  // Sends File objects by their paths on disk. Electron's File objects have no path of their own,
  // so webUtils, available only here, finds it.
  sendFiles: (files) =>
    ipcRenderer.send(
      'android-send-files',
      Array.from(files, (file) => ({
        path: webUtils.getPathForFile(file),
        name: file.name,
        size: file.size,
      })),
    ),
  // Shows a received file in its folder.
  showFile: (id) => ipcRenderer.send('android-show-file', id),
  // The shared clipboard setting, { on, way }, and a request to look at the device's clipboard now.
  clipboardMode: (mode) => ipcRenderer.send('android-clipboard', mode),
  checkClipboard: () => ipcRenderer.send('android-input', { type: 'clipboard-check' }),
  disconnect: () => ipcRenderer.send('android-disconnect'),
});
