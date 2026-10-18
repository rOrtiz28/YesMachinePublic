'use strict';
// Test only. Times a touch on an Android device until the change shows in video decoded here:
//  1. serves a black page that turns white while touched, and opens it in the device's browser;
//  2. starts the advanced-mode stream server on the device over adb;
//  3. in a hidden window, decodes the stream with the hardware decoder (WebCodecs), touches the middle of the screen,
//     and measures until the middle turns white, then releases and measures until it turns black again.
// Usage: electron tools/android-stream/probe serial=<adb serial> [bind=192.168.1.52] [rounds=40] [bitrate=8000000]
// bind= is this computer's address on the device's network, where the device's browser finds the page. The result
// is printed as JSON. viewer.html is the hidden window's page.
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('node:http');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

// The command line's name=value arguments; any argument without "=" is ignored.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.includes('='))
    .map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]),
);
// adb from ADB, or from where the Android SDK installs it on macOS.
const ADB =
  process.env.ADB || path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb');
const JAR = path.join(__dirname, '../../../android/stream/build/yes-machine-stream.jar');
const REMOTE = '/data/local/tmp/yes-machine-stream.jar';
const bind = args.bind || '192.168.1.52';
// The local port that adb forwards to the server's socket on the device.
const port = 27183;
/** Runs adb with these arguments, on the device given by serial= when there is one, and returns its output. */
const adb = (...rest) =>
  execFileSync(ADB, args.serial ? ['-s', args.serial, ...rest] : rest, { encoding: 'utf8' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The page the device shows: black, and white while a finger (or the injected touch) is down. It keeps the browser
// from scrolling, zooming, selecting or opening a menu, so a touch only changes the color.
const PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">
<body style="margin:0;height:100vh;background:#000;touch-action:none;user-select:none;-webkit-user-select:none"><script>
const set = color => { document.body.style.background = color; };
addEventListener('pointerdown', event => { event.preventDefault(); set('#fff'); }, { passive: false });
addEventListener('pointerup', () => set('#000'));
addEventListener('pointercancel', () => set('#000'));
addEventListener('contextmenu', event => event.preventDefault());
</script></body>`;

let server = null,
  page = null;
/**
 * Undoes everything the probe started, each step on its own so one failure doesn't skip the rest: the server and
 * its forwarded port, the page's web server, and the browser on the device, which Home sends to the background.
 */
function cleanup() {
  try {
    server?.kill();
  } catch {}
  try {
    page?.close();
  } catch {}
  try {
    adb('forward', '--remove', `tcp:${port}`);
  } catch {}
  try {
    adb('shell', 'pkill -f local.yesmachine.stream.Server || true');
  } catch {}
  try {
    adb('shell', 'input keyevent KEYCODE_HOME');
  } catch {}
}

app.whenReady().then(async () => {
  // 1. Serve the page and open it on the device; give the browser 4 seconds to show it.
  page = http
    .createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(PAGE);
    })
    .listen(8099, bind);
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `http://${bind}:8099/`);
  await sleep(4000);
  // 2. Start the server as the desktop app does, and wait up to 5 seconds for it to print "ready".
  adb('push', JAR, REMOTE);
  server = spawn(ADB, [
    ...(args.serial ? ['-s', args.serial] : []),
    'shell',
    `CLASSPATH=${REMOTE} app_process / local.yesmachine.stream.Server yes-machine-stream ${Number(args.bitrate || 8000000)}`,
  ]);
  let text = '';
  server.stdout.on('data', (chunk) => {
    text += chunk;
  });
  server.stderr.on('data', (chunk) => {
    text += chunk;
  });
  for (let i = 0; i < 50 && !text.includes('ready'); i++) await sleep(100);
  if (!text.includes('ready')) {
    console.error('server did not start:', text);
    cleanup();
    app.exit(1);
    return;
  }
  adb('forward', `tcp:${port}`, 'localabstract:yes-machine-stream');
  // 3. The hidden window does the measuring. Its page uses Node directly (a socket, and IPC to report back), and
  // keeps running at full speed although it is never shown.
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  ipcMain.once('done', (_event, result) => {
    console.log(
      JSON.stringify({ ...result, serverLog: text.trim().slice(0, 400) || undefined }, null, 1),
    );
    cleanup();
    app.exit(0);
  });
  ipcMain.once('failed', (_event, message) => {
    console.error(message);
    cleanup();
    app.exit(1);
  });
  await window.loadFile(path.join(__dirname, 'viewer.html'), {
    query: { port: String(port), rounds: String(args.rounds || 40) },
  });
});
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});
