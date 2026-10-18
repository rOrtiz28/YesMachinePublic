'use strict';
// Starts the desktop app from source: `npm start` runs this file, and passes any arguments after `npm start --` on
// to the app. Editors that run on Electron can leak ELECTRON_RUN_AS_NODE into their terminals, which would make
// Electron behave like plain Node, so the variable is removed here. The script exits with the app's exit code.
const { spawn } = require('node:child_process');
// In Node, the electron package exports the path of the Electron executable.
const electron = require('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', (code) =>
  process.exit(code ?? 0),
);
