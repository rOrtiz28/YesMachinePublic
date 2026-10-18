'use strict';

// Tests the "Start Yes Machine when you log in" switch (src/main/system/login-item.cjs). The platform is passed in,
// so each platform's case runs on any computer. Linux's autostart entry and macOS's LaunchAgent are real files
// written in a temporary folder that stands in for the home folder; on Windows, Electron's app is a stand-in that
// records what it is asked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createLoginItem,
  applyDefault,
  startedHidden,
  desktopEntry,
  launchAgent,
  autostartFile,
  quote,
} = require('../../src/main/system/login-item.cjs');

/** A new temporary folder that stands in for the home folder, removed when the test `t` ends. */
function home(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-login-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('desktop entry arguments are quoted the way the Exec key expects', () => {
  assert.equal(quote('/opt/yes-machine/yes-machine'), '/opt/yes-machine/yes-machine');
  assert.equal(quote('/home/al/Yes Machine/app'), '"/home/al/Yes Machine/app"');
  assert.equal(quote('/tmp/a"b`c$d\\e'), '"/tmp/a\\"b\\`c\\$d\\\\e"');
  assert.equal(quote('/tmp/100%'), '"/tmp/100%%"');
  const entry = desktopEntry([
    '/home/al/YesMachine/node_modules/electron/dist/electron',
    '/home/al/Yes Machine',
  ]);
  assert.match(entry, /^\[Desktop Entry\]\nType=Application\nName=Yes Machine\n/);
  assert.match(
    entry,
    /\nExec=\/home\/al\/YesMachine\/node_modules\/electron\/dist\/electron "\/home\/al\/Yes Machine" --hidden\n/,
  );
  assert.match(entry, /\nX-GNOME-Autostart-enabled=true\n/);
});

test('the launch agent starts this copy hidden at login and escapes its paths', () => {
  const plist = launchAgent(['/Applications/Yes & Co.app/Contents/MacOS/Yes Machine']);
  assert.match(plist, /<key>Label<\/key><string>local\.yesmachine\.desktop<\/string>/);
  assert.match(
    plist,
    /<string>\/Applications\/Yes &amp; Co\.app\/Contents\/MacOS\/Yes Machine<\/string>\n {4}<string>--hidden<\/string>/,
  );
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>LimitLoadToSessionType<\/key><string>Aqua<\/string>/);
});

test('on Linux the switch writes and removes an autostart entry', (t) => {
  const root = home(t);
  const item = createLoginItem({
    app: null,
    platform: 'linux',
    env: {},
    home: root,
    command: () => ['/opt/yes-machine/yes-machine'],
  });
  const file = path.join(root, '.config', 'autostart', 'yes-machine.desktop');
  assert.equal(item.get(), false);
  assert.equal(item.set(true), true);
  assert.match(fs.readFileSync(file, 'utf8'), /\nExec=\/opt\/yes-machine\/yes-machine --hidden\n/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  assert.equal(item.set(false), false);
  assert.ok(!fs.existsSync(file));
  assert.equal(item.set('yes'), false, 'only true turns it on');
  assert.equal(
    autostartFile({ XDG_CONFIG_HOME: '/custom/config' }, root),
    '/custom/config/autostart/yes-machine.desktop',
  );
  assert.equal(autostartFile({ XDG_CONFIG_HOME: 'relative' }, root), file);
});

test("on macOS the switch writes and removes a LaunchAgent in the user's folder", (t) => {
  const root = home(t);
  const item = createLoginItem({
    app: null,
    platform: 'darwin',
    home: root,
    command: () => ['/Applications/Yes Machine.app/Contents/MacOS/Yes Machine'],
  });
  const file = path.join(root, 'Library', 'LaunchAgents', 'local.yesmachine.desktop.plist');
  assert.equal(item.get(), false);
  assert.equal(item.set(true), true);
  assert.match(fs.readFileSync(file, 'utf8'), /<string>--hidden<\/string>/);
  assert.equal(item.set(false), false);
  assert.ok(!fs.existsSync(file));
});

test('on Windows the switch uses the system login item with the hidden flag', () => {
  let settings = { openAtLogin: false };
  const calls = [];
  // Stands in for Electron's app: it remembers whether the login item is on, and records each call.
  const app = {
    getLoginItemSettings: (options) => {
      calls.push(['get', options]);
      return settings;
    },
    setLoginItemSettings: (options) => {
      calls.push(['set', options]);
      settings = { openAtLogin: options.openAtLogin };
    },
  };
  const item = createLoginItem({
    app,
    platform: 'win32',
    command: () => ['C:\\Yes Machine\\Yes Machine.exe'],
  });
  assert.equal(item.get(), false);
  assert.equal(item.set(true), true);
  assert.deepEqual(calls.find(([kind]) => kind === 'set')[1], {
    openAtLogin: true,
    args: ['--hidden'],
  });
  assert.equal(item.set(false), false);
});

test('only the --hidden flag means the app was started at login', () => {
  assert.equal(startedHidden(['/usr/bin/electron', '.', '--hidden']), true);
  assert.equal(startedHidden(['/usr/bin/electron', '.']), false);
  assert.equal(startedHidden(['/usr/bin/electron', '--hidden-files']), false);
});

test('an installed copy turns the switch on the first time it runs, and leaves it as the person sets it afterwards', (t) => {
  const root = home(t),
    marker = path.join(root, 'data', 'login-item.json');
  const item = createLoginItem({
    app: null,
    platform: 'darwin',
    home: root,
    command: () => ['/Applications/Yes Machine.app/Contents/MacOS/Yes Machine'],
  });
  assert.equal(item.get(), false);
  assert.equal(applyDefault(item, marker, { packaged: true }), true);
  assert.equal(item.get(), true, 'on by default');
  if (process.platform !== 'win32') assert.equal(fs.statSync(marker).mode & 0o777, 0o600);
  item.set(false);
  assert.equal(applyDefault(item, marker, { packaged: true }), false);
  assert.equal(item.get(), false, 'turned off stays off');
});

test('a copy run from source never turns the switch on by itself', (t) => {
  const root = home(t),
    marker = path.join(root, 'data', 'login-item.json');
  const item = createLoginItem({
    app: null,
    platform: 'linux',
    env: {},
    home: root,
    command: () => ['/usr/bin/electron', '/home/me/YesMachine'],
  });
  assert.equal(applyDefault(item, marker, { packaged: false }), false);
  assert.equal(item.get(), false);
  assert.ok(!fs.existsSync(marker));
});
