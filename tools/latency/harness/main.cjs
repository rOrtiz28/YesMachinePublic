'use strict';
// Test only, never packaged. Runs this repository's Yes Machine with a one-time test password read from ./token,
// on port 4778, with its own data folder and no network announcements, plus windows that react to the mouse so
// a viewer can time how long input takes to come back as video. An installed Yes Machine is not touched.
// run.sh (Linux) and run.cmd (Windows) start it; measure.cjs, on the viewer's computer, does the timing.
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// The desktop app's main process: main.cjs, with its modules in folders beside it.
const mainFolder = path.resolve(__dirname, '../../../src/main');
// The test password: 32 hexadecimal characters, as `openssl rand -hex 16` writes them.
const token = fs.readFileSync(path.join(__dirname, 'token'), 'utf8').trim();
if (!/^[0-9a-f]{32}$/.test(token)) throw Error('token must be 32 hex characters');
// Signing in takes this computer's current account name and the test password.
const account = os.userInfo().username;

// --- The app, with three of its modules swapped ---
// Node's module loader is wrapped so that, when main.cjs (in src/main/) asks for one of these modules, it gets a
// stand-in: sign-in accepts only the account and the test password, discovery announces nothing and finds nobody,
// and the real server is used with port 4778 forced. Everything else loads as usual.
const load = Module._load;
Module._load = function (request, parent) {
  if (parent && path.dirname(parent.filename) === mainFolder) {
    if (request === './sharing/auth.cjs')
      return {
        createAuthenticator: () => async (user, password) => user === account && password === token,
      };
    if (request === './network/discovery.cjs')
      return {
        createDiscovery: () => ({
          startAdvertisement: () => true,
          stopAdvertisement() {},
          stop() {},
          getDevices: () => [],
          refresh() {},
        }),
      };
    if (request === './sharing/server.cjs') {
      const real = load.apply(this, arguments);
      return {
        ...real,
        createLanServer: (options) => real.createLanServer({ ...options, port: 4778 }),
      };
    }
  }
  return load.apply(this, arguments);
};
const { app, BrowserWindow, screen } = require('electron');
const { showWindows } = require('../windows.cjs');
require(path.join(mainFolder, 'main.cjs'));
app.setPath('userData', path.join(os.homedir(), '.config', 'ym-latency'));
// The run and stop scripts end a running harness by this process id.
fs.writeFileSync(path.join(__dirname, 'pid'), String(process.pid));
console.log('HARNESS ready on port 4778 as ' + account);

// --- The windows the viewer times ---

// Wayland: one window filling the screen, because an app can't place its windows there. The color changes in its
// top half; with motion, its bottom half scrolls text like the motion window does on X11.
const FILLED = (
  motion,
) => `<!doctype html><body style="margin:0;overflow:hidden;cursor:none;background:#000">
<div id=probe style="position:absolute;left:0;top:0;width:100%;height:50%;background:#000"></div>
<canvas id=c style="position:absolute;left:0;top:50%;width:100%;height:50%;display:${motion ? 'block' : 'none'}"></canvas><script>
addEventListener('mousemove', e => { if (e.clientY < innerHeight / 2) probe.style.background = e.clientX < innerWidth / 2 ? '#000' : '#fff'; });
if (${motion}) {
  const c = document.getElementById('c'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight / 2; x.font = '15px sans-serif';
  const words = 'the quick brown fox jumps over the lazy dog while the cat watches the cars go by on the street'.split(' ');
  const lines = Array.from({length: 400}, (_, i) => Array.from({length: 18}, (_, j) => words[(i * 7 + j * 3) % words.length]).join(' '));
  let offset = 0;
  (function frame() {
    offset = (offset + 3) % (lines.length * 22);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < c.height / 22 + 2; i++) { const n = Math.floor(offset / 22) + i; x.fillStyle = n % 9 === 0 ? '#1d6fd1' : '#222'; x.fillText(lines[n % lines.length], 20, i * 22 - offset % 22 + 18); }
    requestAnimationFrame(frame);
  })();
}
</script></body>`;

app.whenReady().then(() => {
  if (process.env.XDG_SESSION_TYPE === 'wayland') {
    // Wait until sharing has started and control is allowed, so the full-screen window doesn't cover the
    // desktop's Share Screen dialog or the one that allows control. The check runs in the app's main window
    // (host.html), where `media` is the shared screen and `api` the app's bridge to its main process.
    const ready =
      '(async () => Boolean(media) && (await api.info()).permissions.remote === "allowed")()';
    const waitForSharing = setInterval(async () => {
      const host = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith('host.html'),
      );
      if (!host || !(await host.webContents.executeJavaScript(ready).catch(() => false))) return;
      clearInterval(waitForSharing);
      const filled = new BrowserWindow({
        fullscreen: true,
        frame: false,
        show: false,
        backgroundColor: '#000000',
        webPreferences: { sandbox: true, backgroundThrottling: false },
      });
      filled.loadURL('data:text/html,' + encodeURIComponent(FILLED(process.env.YM_MOTION === '1')));
      // Once it has shown for 1.5 seconds, log PATTERN with the top half of the screen as the color window.
      filled.once('ready-to-show', () => {
        filled.show();
        const display = screen.getPrimaryDisplay().bounds;
        setTimeout(
          () =>
            console.log(
              'PATTERN ' +
                JSON.stringify({
                  window: {
                    x: display.x,
                    y: display.y,
                    width: display.width,
                    height: Math.floor(display.height / 2),
                  },
                  display,
                }),
            ),
          1500,
        );
      });
    }, 1000);
    return;
  }
  // On X11 and Windows an app can place its windows, so the usual ones from windows.cjs are shown.
  showWindows(
    { BrowserWindow, screen },
    { motion: process.env.YM_MOTION === '1', heavy: process.env.YM_HEAVY === '1' },
  );
});
