'use strict';
// The "Start Yes Machine when you log in" switch. It is on by default, like the apps that open as
// the computer starts, and each platform keeps it its own way:
// - Linux: a desktop entry in the XDG autostart folder.
// - macOS: a LaunchAgent in the user's own folder.
// - Windows: the system's login item, through Electron.
// Each starts the app with --hidden, so only its icon in the top bar or notification area shows.
//
// main.cjs creates the switch with createLoginItem(), applies the first-run default with
// applyDefault(), and keeps the window hidden when startedHidden() says the login started it. The
// host window reads and flips the switch through the login-item and set-login-item IPC channels.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The flag a start at login adds (see startedHidden()).
const HIDDEN = '--hidden';
// The LaunchAgent's label and file name on macOS, the same as the app's ID (appId in package.json).
const LABEL = 'local.yesmachine.desktop';

// --- Where the setting lives ---

/**
 * The Linux autostart entry: autostart/yes-machine.desktop in $XDG_CONFIG_HOME, or in ~/.config
 * when that variable is unset or isn't an absolute path (the XDG spec says to ignore a relative
 * one).
 */
function autostartFile(env = process.env, home = os.homedir()) {
  const base =
    env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : path.join(home, '.config');
  return path.join(base, 'autostart', 'yes-machine.desktop');
}

/** The macOS LaunchAgent: ~/Library/LaunchAgents/local.yesmachine.desktop.plist. */
function launchAgentFile(home = os.homedir()) {
  return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

// --- The files' contents ---

/**
 * Quotes one argument for a desktop entry's Exec key. An argument with anything but plain
 * characters goes in double quotes, with ", `, $ and \ escaped by a backslash. A percent sign is
 * doubled, because Exec gives % its own meaning (field codes such as %f).
 */
function quote(argument) {
  if (/^[\w@+=:,./-]+$/.test(argument)) return argument;
  return `"${argument.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`;
}

/** The Linux autostart entry that runs `command` (the program and its arguments) hidden. */
function desktopEntry(command) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Yes Machine',
    'Comment=Share this computer with your devices on the local network',
    `Exec=${[...command, HIDDEN].map(quote).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/**
 * The macOS LaunchAgent that runs `command` (the program and its arguments) hidden. RunAtLoad
 * starts it as soon as the agent loads, which is at login, and LimitLoadToSessionType Aqua loads it
 * only in a graphical login session.
 */
function launchAgent(command) {
  // Escapes the characters that are special in XML text.
  const text = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[...command, HIDDEN].map((argument) => `    <string>${text(argument)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>LimitLoadToSessionType</key><string>Aqua</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

// --- The switch ---

/**
 * Creates the switch: { get(), set(enabled) }. get() says whether it is on; set() turns it on or
 * off and returns the state it ends up in. Call set() as a method (item.set(...)), because it reads
 * this.get().
 *
 * `app` is Electron's app, used for the Windows login item. command() returns the program and
 * arguments that start this copy of Yes Machine, read when the switch turns on. `platform`, `env`
 * and `home` can be replaced in tests.
 */
function createLoginItem({
  app,
  command,
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
}) {
  const file =
    platform === 'linux'
      ? autostartFile(env, home)
      : platform === 'darwin'
        ? launchAgentFile(home)
        : null;
  // Windows: the system keeps the setting. Its args are part of the entry, so --hidden is asked
  // for when reading it too.
  if (!file) {
    return {
      get: () => app.getLoginItemSettings({ args: [HIDDEN] }).openAtLogin === true,
      set(enabled) {
        app.setLoginItemSettings({ openAtLogin: enabled === true, args: [HIDDEN] });
        return this.get();
      },
    };
  }
  // Linux and macOS: the switch is on while the file exists.
  return {
    get: () => fs.existsSync(file),
    set(enabled) {
      if (enabled === true) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          platform === 'linux' ? desktopEntry(command()) : launchAgent(command()),
          { mode: 0o644 },
        );
      } else {
        fs.rmSync(file, { force: true });
      }
      return this.get();
    },
  };
}

/**
 * Applies the default, once. The first time an installed copy runs, it turns the switch on and
 * notes that it did in `markerFile`, so a switch the person turns off afterwards stays off. A copy
 * run from source (`packaged` false) leaves the switch alone, so working on Yes Machine doesn't
 * make a development build start at every login. Returns whether it applied the default this time.
 */
function applyDefault(item, markerFile, { packaged = true } = {}) {
  if (!packaged || fs.existsSync(markerFile)) return false;
  try {
    item.set(true);
  } catch {
    /* the system refused; the switch shows what it has */
  }
  try {
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    fs.writeFileSync(markerFile, `${JSON.stringify({ defaultApplied: true })}\n`, { mode: 0o600 });
  } catch {
    /* without the note, the default is applied again next time */
  }
  return true;
}

/** Whether this copy was started at login: the login entries are what pass --hidden. */
function startedHidden(argv = process.argv) {
  return argv.includes(HIDDEN);
}

module.exports = {
  createLoginItem,
  applyDefault,
  startedHidden,
  desktopEntry,
  launchAgent,
  autostartFile,
  launchAgentFile,
  quote,
  HIDDEN,
};
