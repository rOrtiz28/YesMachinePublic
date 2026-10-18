'use strict';
// Test only, never packaged. Shows the latency harness's windows on a computer whose own Yes Machine is sharing, such
// as a Mac, where the harness itself would need its own screen and input permissions: the black and white window, and
// with motion or heavy the busy one. It logs PATTERN with the window's place, for measure.cjs. The windows need no
// permission; the computer's Yes Machine does the capture and input as usual.
// Start: ../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . [motion|heavy]
const { app, BrowserWindow, screen } = require('electron');
const { showWindows } = require('../windows.cjs');

// motion or heavy, if given after the app's folder. Either one adds the busy window, and heavy fills it with the
// video-like page instead of scrolling text.
const mode = process.argv.slice(2).find((arg) => arg === 'motion' || arg === 'heavy');
app
  .whenReady()
  .then(() =>
    showWindows({ BrowserWindow, screen }, { motion: Boolean(mode), heavy: mode === 'heavy' }),
  );
