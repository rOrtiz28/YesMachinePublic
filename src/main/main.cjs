'use strict';

/**
 * Yes Machine's desktop app: the Electron main process.
 *
 * This file starts the app and connects its parts. It owns the main window (src/windows/host/), which is where the
 * person at this computer sees the network list, shares this computer and opens others. Everything the window does
 * that needs Node.js or the operating system goes through the IPC handlers registered at the end of startup; the
 * window reaches them through its preload bridge (src/preload/host.cjs), and every handler first checks that the call
 * really comes from the main window.
 *
 * The parts it wires together:
 * - sharing/  this computer as a host: the HTTPS and WebSocket server viewers sign in to (server.cjs), the account
 *             password check (auth.cjs) and the choice of screen (screens.cjs). The screen itself is captured and
 *             sent by the main window's page over WebRTC; this process only answers its capture request.
 * - control/  remote control of this computer: keyboard and mouse (input.cjs, or portal-input.cjs on Wayland), the
 *             Windows cursor helper (cursor-win.cjs) and the shared clipboard (clipboard-watch.cjs).
 * - network/  computers on the local network: discovery over mDNS, network names, approved certificates.
 * - viewing/  windows that show other computers.
 * - android/  windows that show and control Android devices, in advanced mode (adb) or general mode (the app).
 * - system/   starting at login, private settings files, the graphics card check.
 *
 * Startup order: command-line switches are set before the app is ready; then, once Electron is ready, the single
 * instance lock, permission handlers, the main window, the helpers above, the IPC handlers, and finally the page.
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  screen,
  clipboard,
  dialog,
  shell,
  systemPreferences,
  safeStorage,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
} = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const { vmwareGraphics } = require('./system/gpu.cjs');
const { createLanServer } = require('./sharing/server.cjs');
const { localAddresses, cutText } = require('./network/security.cjs');
const privateNetworks = require('./network/networks.cjs').createNetworks();
const { createInputController } = require('./control/input.cjs');
const { createWindowsCursor } = require('./control/cursor-win.cjs');
const { createClipboardWatch } = require('./control/clipboard-watch.cjs');
const { listScreens, chooseScreen } = require('./sharing/screens.cjs');
const { createDiscovery } = require('./network/discovery.cjs');
const { probeHosts } = require('./network/probe.cjs');
const { createViewers } = require('./viewing/viewer.cjs');
const { createAuthenticator } = require('./sharing/auth.cjs');
const { createPortalInput } = require('./control/portal-input.cjs');
const {
  createLoginItem,
  applyDefault: applyLoginDefault,
  startedHidden,
} = require('./system/login-item.cjs');
const { createAndroid } = require('./android/advanced-mode.cjs');
const { createAndroidViewers } = require('./android/windows.cjs');
const { createAndroidShare } = require('./android/general-mode.cjs');
const { createTrustStore } = require('./network/trust.cjs');
const { encode: encodeQr } = require('./android/qr.cjs');
const { readJson, writePrivateJson } = require('./system/private-json.cjs');

// --- This computer's name for others -----------------------------------------------------------------------------

/** The operating system and its version, as other devices show it in their lists ("macOS 15.6", "Ubuntu 24.04"). */
function systemName() {
  try {
    if (process.platform === 'darwin') return `macOS ${process.getSystemVersion()}`;
    if (process.platform === 'win32')
      return Number(os.release().split('.')[2]) >= 22000 ? 'Windows 11' : 'Windows 10';
    if (process.platform === 'linux') {
      const release = fs.readFileSync('/etc/os-release', 'utf8'),
        field = (key) => new RegExp(`^${key}="?([^"\n]*)"?$`, 'm').exec(release)?.[1];
      return (
        [field('NAME'), field('VERSION_ID')].filter(Boolean).join(' ') || `Linux ${os.release()}`
      );
    }
  } catch {}
  return '';
}
const SYSTEM = cutText(systemName().replace(/[\x00-\x1f\x7f]/g, ''), 40);
const authenticate = createAuthenticator();

// --- Chromium settings that must be set before the app is ready ----------------------------------------------------

app.setName('Yes Machine');
// WebRTC may offer this computer's private addresses (the local network), not only public ones.
app.commandLine.appendSwitch(
  'force-webrtc-ip-handling-policy',
  'default_public_and_private_interfaces',
);
// Every shared frame asks the viewer to show it within 40 ms. Left alone, the viewer sizes its buffer for the
// slowest frame it has seen, usually the first full frame, and held every frame 120 to 300 ms on a local network.
// Measured round trips from a mouse move to the change on screen went from about 160 ms to 80 ms, and 40 ms of room
// keeps bad Wi-Fi smoother than showing every frame the instant it arrives.
app.commandLine.appendSwitch(
  'force-fieldtrials',
  'WebRTC-ForceSendPlayoutDelay/min_ms:0,max_ms:40/',
);
// Chromium won't use VMware's virtual graphics card, which made sharing from a Windows virtual machine about twice as
// slow; there Yes Machine uses it anyway (src/main/system/gpu.cjs has the numbers, and why not on Linux).
if (
  vmwareGraphics({
    run: (file, args) => {
      try {
        return execFileSync(file, args, { encoding: 'utf8', timeout: 3000, windowsHide: true });
      } catch (error) {
        return String(error.stdout || '');
      }
    },
  })
)
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

// --- State --------------------------------------------------------------------------------------------------------

// The main window, and this computer's hosting session: the server viewers sign in to, whether it's ready for one,
// whether it's starting, the Linux sound capture, the captured screen's source, and the input controller. Each new
// start or stop bumps `generation`, so a step that finishes late can tell that it belongs to an earlier start.
let window,
  server = null,
  ready = false,
  starting = false,
  audioProcess = null,
  sourceId = null,
  controller = null,
  generation = 0;
// Computers found on the network, the windows that show other computers, the Wayland portal, the tray icon, whether
// the app is quitting, and the Android helpers.
let discovery = null,
  nearbyDevices = [],
  discoveryError = '',
  viewers = null,
  portal = null,
  tray = null,
  leaving = false,
  android = null,
  androidViewers = null,
  androidShare = null;
// The native input library (RobotJS), or why it couldn't load.
let robot = null,
  robotError = '';
// Windows only: a viewer with a mouse shows this computer's cursor with its own pointer
// (src/main/control/cursor-win.cjs). The cursor's current shape goes to the viewer while that is on.
let cursor = null,
  localCursor = false,
  cursorShape = 'default';

// --- The shared clipboard ------------------------------------------------------------------------------------------

// This computer's clipboard: Electron's, or in a Wayland session also the portal's, since a Wayland window reaches the
// clipboard only while it has focus, and while someone controls this computer Yes Machine doesn't.
const hostClipboard = {
  readText: () =>
    wayland && portal?.state === 'allowed' ? portal.clipboard.readText() : clipboard.readText(),
  writeText: (text) => {
    clipboard.writeText(text);
    if (wayland && portal?.state === 'allowed')
      try {
        portal.clipboard.writeText(text);
      } catch {}
  },
};
// This computer's clipboard goes to the viewer when it changes, while the page asks for that (see 'clipboard-watch').
const clipboardWatch = createClipboardWatch({
  clipboard: hostClipboard,
  onChange: (text) => tellWindow('host-event', { type: 'clipboard', text }),
});

// --- Screens and native input ------------------------------------------------------------------------------------

// The screen to share, chosen on this computer or from the viewer and kept in userData (src/main/sharing/screens.cjs).
let screenChoice = null,
  screenFile = null;
try {
  robot = require('@jitsi/robotjs');
  robot.setKeyboardDelay(0);
  robot.setMouseDelay(0);
} catch (error) {
  robotError = error.message;
}
// In a Wayland session, X11 input tools can't reach native windows, so input goes through the RemoteDesktop portal.
const wayland =
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

/** This computer's screens, for the Share screen choice. In a Wayland session the desktop's own dialog picks one. */
function screens() {
  return wayland ? [] : listScreens(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
}

/** The display being shared: the one chosen, or the main one. On Wayland it stays the main one here. */
function sharedDisplay() {
  const primary = screen.getPrimaryDisplay(),
    chosen = chooseScreen(screens(), screenChoice);
  return screen.getAllDisplays().find((display) => String(display.id) === chosen?.id) || primary;
}

/**
 * The shared screen's rectangle in the units native input takes. Electron measures screens in points (physical pixels
 * divided by the display's scale); macOS and the Wayland portal take points too, but Windows and X11 take physical
 * pixels, so on a Windows screen at 200% the pointer used to land halfway to where it should.
 */
function inputBounds() {
  const display = sharedDisplay();
  if (process.platform === 'darwin' || wayland) return display.bounds;
  if (process.platform === 'win32') return screen.dipToScreenRect(null, display.bounds);
  const scale = display.scaleFactor || 1,
    { x, y, width, height } = display.bounds;
  return {
    x: Math.round(x * scale),
    y: Math.round(y * scale),
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

// --- Talking to the main window ----------------------------------------------------------------------------------

/** Sends a message to the main window's page on one of its channels ('host-event', 'signal', 'discovery'...). */
function tellWindow(channel, data) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, data);
}

/** What this computer lets Yes Machine do: record the screen, control input, and how (shown in Settings). */
function permissions() {
  return {
    screen:
      process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'system-managed',
    input: process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false),
    native: !!robot,
    wayland,
    remote: wayland ? portal?.state || 'off' : null,
    robotError,
  };
}

// --- Stopping a hosting session ----------------------------------------------------------------------------------

function stopAudio() {
  if (audioProcess) {
    audioProcess.kill('SIGTERM');
    audioProcess = null;
  }
}

/** Gives Windows its own cursor back (see the Windows cursor helper). */
function endLocalCursor() {
  localCursor = false;
  cursor?.stop();
}

/**
 * Stops sharing this computer: releases any keys or buttons the viewer held, stops sound capture, the Wayland portal
 * session and the network announcement, tells the page, and closes the server (which disconnects the viewer).
 */
async function stopHosting() {
  clipboardWatch.stop();
  generation++;
  starting = false;
  ready = false;
  stopAudio();
  controller?.releaseAll();
  portal?.stop();
  endLocalCursor();
  discovery?.stopAdvertisement();
  const previous = server;
  server = null;
  tellWindow('host-event', { type: 'stopped' });
  updateTray();
  if (previous) await previous.stop();
}

// --- The main window and the tray icon ---------------------------------------------------------------------------

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** A viewer window closed because its session ended: the main window comes forward and says why. */
function sessionEnded(details) {
  showWindow();
  tellWindow('host-event', { type: 'viewer-ended', ...details });
}

// The small icon in the top bar (the menu bar on a Mac, the notification area on Windows) while the app runs.
// Closing the window leaves Yes Machine running there, so other devices can still reach this computer.
const TRAY_PLACE =
  process.platform === 'darwin'
    ? 'the menu bar'
    : process.platform === 'win32'
      ? 'the notification area'
      : 'the top bar';

/** Updates the tray icon's tooltip and menu: whether this computer is sharing, and Open and Quit. */
function updateTray() {
  if (!tray) return;
  const status = server ? `Sharing on ${new URL(server.url).hostname}` : 'Not sharing';
  tray.setToolTip(`Yes Machine · ${status}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Open Yes Machine', click: showWindow },
      { label: 'Quit Yes Machine', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  const image = nativeImage.createFromPath(
    path.join(
      __dirname,
      '../../assets',
      process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png',
    ),
  );
  // A template image follows the Mac's menu bar colors.
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  if (process.platform !== 'linux') tray.on('click', () => tray.popUpContextMenu());
  updateTray();
}

/** The first time the window closes, a notification says where Yes Machine went. */
function remindStillRunning() {
  const file = path.join(app.getPath('userData'), 'tray-reminder.json');
  if (readJson(file, {}).shown || !Notification.isSupported()) return;
  writePrivateJson(file, { shown: true });
  // Some Linux desktops, such as GNOME without its AppIndicator extension, show no tray icons; opening the app
  // again always works, because the running copy then shows its window.
  new Notification({
    title: 'Yes Machine is still running',
    body: `Other devices can still connect. To show it, open Yes Machine again or use its icon in ${TRAY_PLACE}.`,
    silent: true,
  }).show();
}

// --- IPC: only the main window's own page may call --------------------------------------------------------------

/** Whether an IPC call comes from the main window's top frame, and not from any other page or frame. */
function trusted(ipcEvent) {
  return (
    ipcEvent.sender === window?.webContents && ipcEvent.senderFrame === window.webContents.mainFrame
  );
}

/** Registers an IPC handler that only the main window's page may call. */
function handle(name, fn) {
  ipcMain.handle(name, async (ipcEvent, ...args) => {
    if (!trusted(ipcEvent)) throw Error('Untrusted caller');
    return fn(...args);
  });
}

// --- Startup -----------------------------------------------------------------------------------------------------

app.whenReady().then(() => {
  // One copy runs at a time; opening Yes Machine again shows the window of the copy already running.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', showWindow);
  // A packaged app gets its icon from the bundle. Run from source, macOS would show Electron's icon in the Dock.
  if (process.platform === 'darwin' && !app.isPackaged)
    app.dock?.setIcon(path.join(__dirname, '../../assets/icon.png'));

  // Screen capture: only the main window may record the screen; Android device windows may go full screen.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['display-capture', 'media'].includes(permission),
  );
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(
      (wc === window?.webContents && ['display-capture', 'media'].includes(permission)) ||
        (permission === 'fullscreen' && !!androidViewers?.owns(wc)),
    ),
  );
  // When the page asks to capture the screen (getDisplayMedia), it gets the chosen screen, with this computer's sound
  // on macOS and Windows. Linux sound comes from parec instead (see 'linux-audio'). A request from anywhere else, or
  // when sharing isn't starting, gets nothing.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const currentGeneration = generation;
      if ((!starting && !server) || request.frame !== window?.webContents.mainFrame) {
        callback({});
        return;
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const shared = String(sharedDisplay().id);
      const source = sources.find((each) => each.display_id === shared) || sources[0];
      if (!source || generation !== currentGeneration) {
        callback({});
        return;
      }
      sourceId = source.id;
      callback({
        video: source,
        ...(process.platform !== 'linux' && request.audioRequested ? { audio: 'loopback' } : {}),
      });
    } catch (error) {
      tellWindow('host-event', { type: 'error', message: error.message });
      callback({});
    }
  });

  // Night or day. The page draws its own title bar. macOS keeps its traffic lights; Windows and Linux get native
  // controls in the app's colors, night or day as the page last chose (it tells this process through set-theme), so
  // the window opens in them. The viewer windows follow too: their pages go light with prefers-color-scheme, which
  // nativeTheme sets for every window.
  const themeFile = path.join(app.getPath('userData'), 'theme.json');
  const THEMES = {
    night: { background: '#0d1115', symbols: '#9aa6ae', scheme: 'dark' },
    day: { background: '#eef2f5', symbols: '#46545f', scheme: 'light' },
  };
  const opened = THEMES[readJson(themeFile, {}).mode] || THEMES.night;
  let theme = opened;
  nativeTheme.themeSource = theme.scheme;
  const titleBar =
    process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 24, y: 26 } }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: opened.background, symbolColor: opened.symbols, height: 44 },
        };

  // The main window. Started at login, it stays hidden; its page still loads, so sharing starts on its own as usual.
  // The page keeps full-speed timers while hidden, because it carries the session.
  window = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 820,
    minHeight: 680,
    title: 'Yes Machine',
    backgroundColor: opened.background,
    icon: path.join(__dirname, '../../assets/icon.png'),
    ...titleBar,
    show: !startedHidden(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/host.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Windows that show other computers. Certificates approved for computers and for Android devices in general mode
  // are kept together.
  const trustStore = createTrustStore(path.join(app.getPath('userData'), 'trusted-hosts.json'));
  viewers = createViewers({
    store: trustStore,
    credentialFile: path.join(app.getPath('userData'), 'remembered-sign-ins.json'),
    safeStorage,
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: () => theme.background,
    onConnected: (keys) => tellWindow('host-event', { type: 'connected', keys }),
    onEnded: ({ name, reason }) => sessionEnded({ name, reason }),
  });
  // The main window never opens other windows or navigates away from its page.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (navigation) => navigation.preventDefault());

  // Android devices. Advanced mode: devices that adb reaches, over USB or wireless debugging.
  android = createAndroid({
    jarPath: app.isPackaged
      ? path.join(process.resourcesPath, 'yes-machine-stream.jar')
      : path.join(__dirname, '../../android/stream/build/yes-machine-stream.jar'),
    onDevices: (devices) => tellWindow('host-event', { type: 'android', devices }),
  });
  // General mode: devices that share their screen through the Yes Machine app. They know this computer by its name,
  // without .local, and by its own certificate.
  const computer = {
    name: cutText(os.hostname().replace(/\.local$/i, ''), 64),
    system: SYSTEM,
  };
  androidShare = createAndroidShare({
    identityFile: path.join(app.getPath('userData'), 'private-network', 'device-client.json'),
    store: trustStore,
    ...computer,
  });
  // Device windows, in either mode. Devices controlled from here share this computer's clipboard and exchange files.
  androidViewers = createAndroidViewers({
    android,
    share: androidShare,
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: () => theme.background,
    clipboard: hostClipboard,
    computer,
    onConnected: (ids) => tellWindow('host-event', { type: 'android-connected', ids }),
    onEnded: ({ name, general, reason }) =>
      sessionEnded({
        name,
        reason: reason === 'general' ? 'general-mode' : reason === 'closed' ? 'closed' : 'lost',
        android: true,
        general,
      }),
  });
  // The list only shows while the window is open, so adb is asked only then; a hidden window leaves adb alone.
  window.on('show', () => android.startPolling());
  window.on('hide', () => android.stop());
  if (!startedHidden()) android.startPolling();

  // Closing the window hides it, and Yes Machine keeps running in the tray, unless the app is quitting.
  window.on('close', (closing) => {
    if (leaving) return;
    closing.preventDefault();
    window.hide();
    remindStillRunning();
  });
  window.on('closed', () => {
    stopHosting();
    discovery?.stop();
    discovery = null;
    window = null;
  });
  createTray();

  // Computers on the network (mDNS). If discovery can't start, computers can still be added by address.
  try {
    discovery = createDiscovery({
      onDevices: (devices) => {
        nearbyDevices = devices;
        if (devices.length) discoveryError = '';
        tellWindow('discovery', { devices, error: discoveryError });
      },
      onAndroid: (devices) => {
        androidShare.setDevices(devices);
        tellWindow('host-event', { type: 'android-sharing', devices });
      },
      onError: (message) => {
        discoveryError = message?.message || String(message);
        if (
          typeof message?.causeCode === 'string' &&
          /^[A-Z][A-Z0-9_]{0,47}$/.test(message.causeCode)
        )
          discoveryError += ` (${message.causeCode})`;
        // Keep only the latest bounded discovery diagnostic on this computer.
        // This never contains a password, certificate key, or packet payload.
        const diagnostic = {
          time: new Date().toISOString(),
          stage: message?.stage || 'unknown',
          code: message?.causeCode || '',
          name: message?.causeClass || '',
          detail: String(message?.cause?.message || '').slice(0, 500),
          stack: String(message?.cause?.stack || '').slice(0, 2500),
        };
        fs.promises
          .writeFile(
            path.join(app.getPath('userData'), 'discovery-diagnostic.json'),
            JSON.stringify(diagnostic, null, 2),
            { mode: 0o600 },
          )
          .catch(() => {});
        tellWindow('discovery', { devices: nearbyDevices, error: discoveryError });
      },
    });
  } catch (error) {
    discoveryError = 'Discovery is unavailable. Connect by IP address instead.';
  }

  // Remote control of this computer. In a Wayland session, input goes through the desktop's RemoteDesktop portal
  // instead of X11. The controller only acts while a viewer is signed in and this computer allows it.
  if (wayland)
    portal = createPortalInput({
      tokenFile: path.join(app.getPath('userData'), 'wayland-remote-control.json'),
      bounds: () => screen.getPrimaryDisplay().bounds,
      onState: (state) => tellWindow('host-event', { type: 'remote-control', state }),
    });
  controller = createInputController({
    robot: wayland ? portal.robot : robot,
    clipboard,
    bounds: inputBounds(),
    platform: process.platform,
    allowed: () =>
      ready &&
      !!server?.viewerId &&
      permissions().input &&
      (!wayland || portal.state === 'allowed'),
    onError: (message) => tellWindow('host-event', { type: 'error', message: String(message) }),
  });
  if (process.platform === 'win32') {
    // A file marks blank cursors, so they come back even if Yes Machine and its helper were killed together.
    const blank = path.join(app.getPath('userData'), 'cursors-hidden');
    cursor = createWindowsCursor({
      onShape: (shape) => {
        cursorShape = shape;
        if (localCursor) tellWindow('host-event', { type: 'cursor', shape });
      },
      marked: (on) => {
        try {
          if (on) fs.writeFileSync(blank, '');
          else fs.rmSync(blank, { force: true });
        } catch {}
      },
    });
    if (fs.existsSync(blank)) cursor.restore();
  }
  // A new resolution or scale (a virtual machine's window resized, a monitor plugged in) moves the pointer's pixels.
  for (const change of ['display-metrics-changed', 'display-added', 'display-removed'])
    screen.on(change, () => {
      controller.setBounds(inputBounds());
      tellWindow('host-event', { type: 'screens' });
    });
  screenFile = path.join(app.getPath('userData'), 'shared-screen.json');
  screenChoice = readJson(screenFile, {}).id || null;
  controller.setBounds(inputBounds());

  // --- IPC handlers: appearance and screens ---

  // Night or day, chosen with the sun and moon in the page: every window's background, the title bar's controls on
  // Windows and Linux, and the color scheme viewer pages follow.
  handle('set-theme', (mode) => {
    const colors = THEMES[mode];
    if (!colors || !window || window.isDestroyed()) return;
    theme = colors;
    nativeTheme.themeSource = colors.scheme;
    for (const each of BrowserWindow.getAllWindows()) each.setBackgroundColor(colors.background);
    if (process.platform !== 'darwin')
      window.setTitleBarOverlay?.({ color: colors.background, symbolColor: colors.symbols });
    writePrivateJson(themeFile, { mode });
  });
  handle('screens', () => {
    const list = screens();
    return { screens: list, current: chooseScreen(list, screenChoice)?.id || null };
  });
  handle('choose-screen', (id) => {
    const list = screens();
    if (!list.some((item) => item.id === String(id)))
      throw Error('That screen isn’t connected anymore.');
    screenChoice = String(id);
    writePrivateJson(screenFile, { id: screenChoice });
    controller.setBounds(inputBounds());
    return { screens: list, current: screenChoice };
  });

  // Everything the page shows about this computer when it loads.
  handle('info', () => ({
    name: os.hostname(),
    account: os.userInfo().username,
    platform: process.platform,
    system: SYSTEM,
    addresses: privateNetworks(),
    connected: viewers.connected(),
    android: {
      available: android.available,
      devices: android.devices(),
      sharing: androidShare.devices(),
      connected: androidViewers.connected(),
    },
    permissions: permissions(),
    version: app.getVersion(),
    devices: nearbyDevices,
    discoveryError,
  }));

  // --- IPC handlers: sharing this computer ---

  // Sharing starts in two steps. 'start' lets the page capture the screen (the display media handler above answers
  // only while starting); 'listen' then starts the server on the chosen network address and announces it.
  handle('start', async () => {
    if (server || starting) throw Error('Sharing is already active.');
    generation++;
    starting = true;
    return { ok: true };
  });
  handle('listen', async (address) => {
    const currentGeneration = generation;
    try {
      if (!starting || server) throw Error('Start a screen capture first.');
      if (!localAddresses().some((each) => each.address === address))
        throw Error('Select an available private network.');
      controller.setBounds(inputBounds());
      const created = await createLanServer({
        address,
        authenticate,
        directory: path.join(app.getPath('userData'), 'private-network'),
        publicDirectory: path.join(__dirname, '../../public'),
        hostName: os.hostname(),
        platform: process.platform,
        isReady: () => ready,
        onSignal: (signal) => tellWindow('signal', signal),
        onPeer: (peer) => {
          if (peer.type === 'viewer-left') {
            controller.releaseAll();
            endLocalCursor();
          }
          // A new viewer starts with this computer's cursor in the picture until it asks for its own pointer.
          if (peer.type === 'viewer-joined') endLocalCursor();
          tellWindow('host-event', peer);
        },
        // A file the viewer sent: this computer asks where to keep it.
        onUpload: async (transfer) => {
          try {
            const current = server;
            if (!current || current.viewerId !== transfer.sessionId) return;
            const result = await dialog.showSaveDialog(window, {
              title: 'Save received file',
              defaultPath: path.join(app.getPath('downloads'), transfer.name),
              buttonLabel: 'Save file',
            });
            if (
              !result.canceled &&
              result.filePath &&
              server === current &&
              current.viewerId === transfer.sessionId
            ) {
              // Moved rather than copied, so a large file doesn't take twice the room or time; a copy only across disks.
              await fs.promises.rename(transfer.path, result.filePath).catch((error) => {
                if (error.code !== 'EXDEV') throw error;
                return fs.promises.copyFile(transfer.path, result.filePath);
              });
              tellWindow('host-event', { type: 'notice', message: `Saved ${transfer.name}` });
            }
          } catch (error) {
            tellWindow('host-event', { type: 'error', message: error.message });
          } finally {
            fs.promises.unlink(transfer.path).catch(() => {});
          }
        },
      });
      // Stopped while the server was starting: close the new server instead of keeping it.
      if (generation !== currentGeneration || !starting) {
        await created.stop();
        throw Error('Sharing was canceled.');
      }
      server = created;
      ready = true;
      starting = false;
      // The first time, the desktop asks the person here to allow remote control; later the portal remembers.
      if (wayland) portal.start();
      updateTray();
      discovery?.startAdvertisement({
        address,
        port: Number(new URL(server.url).port),
        hostName: os.hostname(),
        platform: process.platform,
        fingerprint: server.fingerprint,
        system: SYSTEM,
      });
      return {
        url: server.url,
        fingerprint: server.fingerprint,
        permissions: permissions(),
        sourceId,
      };
    } catch (error) {
      if (generation === currentGeneration) {
        starting = false;
        await stopHosting();
      }
      throw error;
    }
  });
  handle('stop', async () => {
    starting = false;
    await stopHosting();
    return true;
  });

  // --- IPC handlers: the viewer's session ---

  // WebRTC signaling between the page and the signed-in viewer, through the server.
  handle('signal', (id, message) => {
    server?.signal(id, message);
  });
  // Everything the viewer sends: keys, pointer, clipboard and its own-pointer request. Only the current viewer counts.
  handle('input', async (id, message) => {
    if (!ready || server?.viewerId !== id)
      return { type: 'error', message: 'Session no longer active.' };
    // Clipboard can work while input permission is missing, but only in the current paired session.
    if (message?.type === 'clipboard-get')
      return { type: 'clipboard', text: hostClipboard.readText().slice(0, 1024 * 1024) };
    if (message?.type === 'clipboard-set') {
      if (typeof message.text !== 'string' || message.text.length > 1024 * 1024)
        return { type: 'error', message: 'Clipboard text is too large.' };
      clipboardWatch.note(message.text);
      hostClipboard.writeText(message.text);
      return null;
    }
    if (message?.type === 'local-cursor') {
      localCursor = message.on === true && !!cursor && permissions().input;
      if (localCursor) {
        cursor.hide();
        tellWindow('host-event', { type: 'cursor', shape: cursorShape });
      } else cursor?.show();
      return { type: 'local-cursor', on: localCursor };
    }
    try {
      return controller.handle(message);
    } catch (error) {
      return { type: 'error', message: error.message };
    }
  });
  handle('release', () => controller.releaseAll());
  handle('disconnect', () => {
    controller.releaseAll();
    server?.disconnect();
  });
  // A file for the viewer, chosen on this computer.
  handle('send-file', async () => {
    const current = server;
    if (!current?.viewerId) throw Error('Connect a viewer first.');
    const intendedViewer = current.viewerId;
    const result = await dialog.showOpenDialog(window, {
      title: 'Send a file to your viewer',
      properties: ['openFile'],
    });
    if (result.canceled) return;
    if (server !== current || current.viewerId !== intendedViewer)
      throw Error('The original viewer disconnected.');
    await current.sendFile(result.filePaths[0]);
    return path.basename(result.filePaths[0]);
  });

  // --- IPC handlers: other computers ---

  handle('probe', (targets) => probeHosts(targets));
  handle('refresh-discovery', () => {
    discovery?.refresh();
    return true;
  });
  // The shared clipboard: the page turns watching this computer's clipboard on and off as viewers come and go.
  handle('clipboard-watch', (on) => {
    if (on === true && server?.viewerId) clipboardWatch.start();
    else clipboardWatch.stop();
  });
  handle('copy-address', async (value) => {
    if (typeof value !== 'string' || value.length > 1024) throw Error('Invalid text');
    await clipboard.writeText(value);
  });
  handle('inspect', (target) => viewers.inspect(target));
  handle('focus-viewer', (target) => viewers.focus(target));

  // --- IPC handlers: Android devices ---

  const deviceId = (id) => {
    if (typeof id !== 'string' || !id || id.length > 300) throw Error('Unknown device.');
    return id;
  };
  handle('android-open', (id, transport) =>
    androidViewers.open(
      deviceId(id),
      ['usb', 'wifi', 'network'].includes(transport) ? transport : undefined,
    ),
  );
  // General mode: the device's certificate is checked, and approved the first time, before its window opens.
  handle('android-inspect', (id) => androidShare.inspect(deviceId(id)));
  handle('android-trust', (id) => {
    androidShare.trust(deviceId(id));
    return true;
  });
  // Wi-Fi pairing for Android devices: the page shows the code and hears how it goes.
  let pairing = null;
  handle('android-pair-start', () => {
    if (!android.available)
      throw Error('Yes Machine needs Android’s platform tools (adb) on this computer.');
    pairing?.cancel();
    pairing = android.pair((state) =>
      tellWindow('host-event', { type: 'android-pairing', ...state }),
    );
    return { modules: encodeQr(pairing.text) };
  });
  handle('android-pair-stop', () => {
    pairing?.cancel();
    pairing = null;
  });

  // --- IPC handlers: signing in to other computers ---

  handle('trust', (target) => viewers.trust(target));
  const windowName = (name) =>
    typeof name === 'string' && name.trim() ? cutText(name.trim(), 64) : 'Computer';
  handle('sign-in', (target, credentials, name) =>
    viewers.signIn(target, credentials, windowName(name)),
  );
  handle('sign-in-saved', (target, name) => viewers.signInSaved(target, windowName(name)));
  // Settings' lists of trusted certificates and remembered sign-ins, and forgetting the ones checked there, by
  // "address:port" key.
  const keysFrom = (keys) =>
    Array.isArray(keys) ? keys.filter((key) => typeof key === 'string').slice(0, 1000) : [];
  handle('trusted-list', () => viewers.trusted());
  handle('forget-trusted', (keys) => {
    viewers.forgetTrusted(keysFrom(keys));
    return true;
  });
  handle('credentials-info', () => viewers.credentials());
  handle('forget-credentials', (keys) => {
    viewers.forgetCredentials(keysFrom(keys));
    return true;
  });

  // --- IPC handlers: settings and permissions ---

  handle('accessibility', () => {
    if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true);
    return permissions();
  });
  // Starting at login, on by default for an installed copy (src/main/system/login-item.cjs).
  const loginItem = createLoginItem({
    app,
    command: () =>
      process.env.APPIMAGE
        ? [process.env.APPIMAGE]
        : app.isPackaged
          ? [process.execPath]
          : [process.execPath, app.getAppPath()],
  });
  applyLoginDefault(loginItem, path.join(app.getPath('userData'), 'login-item.json'), {
    packaged: app.isPackaged,
  });
  handle('login-item', () => loginItem.get());
  handle('set-login-item', (enabled) => loginItem.set(enabled === true));
  handle('screen-settings', () => {
    if (process.platform === 'darwin')
      return shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
  });

  // Linux has no system sound in screen capture, so parec records the default output's monitor as raw 48 kHz stereo
  // PCM, and the page plays it into the WebRTC session.
  handle('linux-audio', () => {
    if (process.platform !== 'linux' || (!starting && !server)) return false;
    stopAudio();
    const capture = spawn(
      'parec',
      [
        '--raw',
        '--format=s16le',
        '--rate=48000',
        '--channels=2',
        '--device=@DEFAULT_MONITOR@',
        '--latency-msec=20',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    audioProcess = capture;
    capture.stdout.on('data', (bytes) => {
      if (audioProcess === capture && (starting || ready)) tellWindow('audio-pcm', bytes);
    });
    capture.stderr.on('data', () => {});
    capture.on('error', () => {
      if (audioProcess === capture)
        tellWindow('host-event', {
          type: 'audio-error',
          message:
            'System audio needs parec (pulseaudio-utils) and a running PulseAudio or PipeWire-Pulse server.',
        });
    });
    capture.on('exit', (code) => {
      if (code && audioProcess === capture)
        tellWindow('host-event', {
          type: 'audio-error',
          message: 'System audio capture stopped. Check the default output monitor.',
        });
    });
    return true;
  });

  // --- The page ---

  // Sharing starts on its own when the setting allows it; the gesture flag lets screen capture begin without a click.
  window.webContents.on('did-finish-load', () =>
    window?.webContents.executeJavaScript('window.autoShare?.()', true).catch(() => {}),
  );
  window.loadFile(path.join(__dirname, '../windows/host/host.html'));
});

// --- Quitting ----------------------------------------------------------------------------------------------------

app.on('window-all-closed', () => app.quit());
// Windows' own cursors come back however the app ends.
app.on('will-quit', () => cursor?.stop());
app.on('activate', showWindow);
// Quitting while sharing first stops the session properly, so the viewer hears it ended.
let quitting = false;
app.on('before-quit', (quit) => {
  leaving = true;
  if (quitting || !server) return;
  quit.preventDefault();
  quitting = true;
  stopHosting().finally(() => app.quit());
});
