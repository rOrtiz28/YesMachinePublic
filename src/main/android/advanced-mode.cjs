'use strict';
// Advanced mode for Android devices: the ones adb reaches, over USB or with wireless debugging. For each, the computer
// pushes Yes Machine's stream server (android/stream) to the device, starts it with the debugging shell's permissions,
// and connects through an adb port forward. Nothing needs to be installed on the device. Wi-Fi debugging is paired
// with a QR code the device scans, as Android Studio does it. A device whose Yes Machine app is set to general mode
// connects through the app instead (general-mode.cjs), so advanced mode leaves it alone.
//
// main.cjs creates one of these. It polls adb while the main window shows, so the page can list the devices, and
// starts Wi-Fi pairing when the page asks (qr.cjs makes the QR code). windows.cjs opens a session with
// connect() when a device's window opens, and takes screenshots with screenshot(). The session's stream follows
// protocol.cjs, and its file connection files.cjs.
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Where the stream server goes on the device: a folder the debugging shell can write to and run from.
const REMOTE = '/data/local/tmp/yes-machine-stream.jar';
// A serial adb gives a device it reaches over Wi-Fi: an mDNS service name, or an address with a port.
const WIRELESS = /\._adb-tls-connect\._tcp$|:\d+$/;
const PAIRING_TIME = 3 * 60 * 1000; // how long a pairing code waits to be scanned
// The characters of pairing passwords: letters and digits without the look-alikes l, o, I, O, 0 and 1.
const PASSWORD = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// The Yes Machine app's screen-sharing service answers this action only while the app is in general mode.
const SHARE_SCREEN = 'local.yesmachine.android.SHARE_SCREEN';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Finding adb and reading what it prints ---

/**
 * Finds adb: the ADB environment variable first, then the platform-tools of the Android SDK (ANDROID_HOME,
 * ANDROID_SDK_ROOT, then where Android Studio puts the SDK on macOS, Linux and Windows), then where package managers
 * put it (Homebrew on Apple silicon and Intel Macs, and /usr/bin). Returns its path, or null. The arguments are for
 * tests.
 */
function findAdb(env = process.env, home = os.homedir(), exists = fs.existsSync) {
  const name = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    env.ADB,
    env.ANDROID_HOME && path.join(env.ANDROID_HOME, 'platform-tools', name),
    env.ANDROID_SDK_ROOT && path.join(env.ANDROID_SDK_ROOT, 'platform-tools', name),
    path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', name),
    path.join(home, 'Android', 'Sdk', 'platform-tools', name),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', name),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    '/usr/bin/adb',
  ];
  return candidates.find((candidate) => candidate && exists(candidate)) || null;
}

/**
 * Reads `adb devices`, which lists one device per line after its header: the serial, which can contain spaces, a
 * tab, and the state. Other lines, such as the header and the notes adb prints when it starts its server, have no
 * tab. Returns [{serial, state, transport}], where transport ('usb' or 'wifi') comes from the serial's form.
 */
function parseDevices(text) {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [serial, state] = line.split('\t');
      return { serial, state: state.trim(), transport: WIRELESS.test(serial) ? 'wifi' : 'usb' };
    });
}

/**
 * One entry per physical device, with each way adb reaches it. entries are parseDevices' entries with each device's
 * id (its serial number, the same over USB and Wi-Fi), name, system and general flag filled in; only those in the
 * 'device' state (connected and authorized) count. Each device gets connections {usb, wifi}, the adb serial for each
 * way, and the transport and serial to use by default: the cable's, being faster. Sorted by name.
 */
function groupDevices(entries) {
  const devices = new Map();
  for (const entry of entries) {
    if (entry.state !== 'device' || !entry.id) continue;
    const known = devices.get(entry.id) || {
      id: entry.id,
      name: entry.name,
      system: entry.system,
      general: entry.general === true,
      connections: {},
    };
    known.connections[entry.transport] = entry.serial;
    devices.set(entry.id, known);
  }
  return [...devices.values()]
    .map((device) => ({
      ...device,
      transport: device.connections.usb ? 'usb' : 'wifi',
      serial: device.connections.usb || device.connections.wifi,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads `adb mdns services`, which lists what adb hears on the network, one service per line: an instance name, a
 * service type and an address, separated by tabs. Returns [{name, type, address}].
 */
function parseServices(text) {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, '').split('\t'))
    .filter((parts) => parts.length >= 3)
    .map(([name, type, address]) => ({
      name: name.trim(),
      type: type.trim(),
      address: address.trim(),
    }));
}

// --- Devices, sessions and pairing ---

/**
 * Creates advanced mode.
 *
 * Options:
 * - adbPath: adb, found with findAdb() unless given. Without it, nothing is available.
 * - jarPath: the stream server, built from android/stream.
 * - onDevices(devices): hears the device list (see groupDevices) whenever it changes.
 * - interval: the milliseconds between polls.
 * - run and start: child_process.execFile and spawn, unless a test passes its own.
 *
 * Returns {startPolling, stop, devices, connect, screenshot, pair, available}.
 */
function createAndroid({
  adbPath = findAdb(),
  jarPath,
  onDevices = () => {},
  run = execFile,
  start = spawn,
  interval = 3000,
} = {}) {
  const details = new Map(); // serial -> { id, name, system }
  let devices = [],
    timer = null,
    polling = false;

  /** Runs adb, for one device when serial is given, and resolves with what it printed, within ten seconds. */
  const adb = (serial, ...args) =>
    new Promise((resolve, reject) => {
      run(
        adbPath,
        serial ? ['-s', serial, ...args] : args,
        { encoding: 'utf8', timeout: 10000, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    });

  /**
   * Asks a device, once per serial, for its serial number (its id), its model, its Android version and the name its
   * owner gave it. A device without a name of its own goes by its model.
   */
  async function describe(serial) {
    if (details.has(serial)) return details.get(serial);
    const text = await adb(
      serial,
      'shell',
      'getprop ro.serialno; getprop ro.product.model; getprop ro.build.version.release; settings get global device_name',
    );
    const [id, model, release, name] = text.split('\n').map((line) => line.trim());
    const detail = {
      id: id || serial,
      name: name && name !== 'null' ? name : model || 'Android device',
      system: release ? `Android ${release}` : 'Android',
    };
    details.set(serial, detail);
    return detail;
  }

  /**
   * Whether the device's Yes Machine app is in general mode. In advanced mode the app turns its screen-sharing
   * service off, so a service answers SHARE_SCREEN only in general mode. It's a quick query: the device's package
   * manager answers, without starting the app. A failure counts as no.
   */
  async function generalMode(serial) {
    try {
      return (
        await adb(
          serial,
          'shell',
          'cmd',
          'package',
          'query-services',
          '--brief',
          '-a',
          SHARE_SCREEN,
        )
      ).includes('local.yesmachine.android/');
    } catch {
      return false;
    }
  }
  /** The error for a device whose app is in general mode, which says how to switch. */
  const generalError = (name) =>
    Error(
      `${name} is set to general mode in Yes Machine. To connect it by cable or Wi-Fi debugging, choose Advanced in Yes Machine’s Settings on it.`,
    );

  /**
   * Reads `adb devices`, describes each ready device, asks each physical device once per poll whether its app is in
   * general mode, and reports the list when it changed. When adb itself fails, the list empties. Only one poll runs
   * at a time.
   */
  async function poll() {
    if (polling || !adbPath) return;
    polling = true;
    try {
      const entries = parseDevices(await adb(null, 'devices')),
        modes = new Map();
      for (const entry of entries) {
        if (entry.state !== 'device') continue;
        try {
          Object.assign(entry, await describe(entry.serial));
          if (!modes.has(entry.id)) modes.set(entry.id, await generalMode(entry.serial));
          entry.general = modes.get(entry.id);
        } catch {
          /* it went away while being asked; without an id, groupDevices leaves it out */
        }
      }
      const next = groupDevices(entries);
      if (JSON.stringify(next) !== JSON.stringify(devices)) {
        devices = next;
        onDevices(devices);
      }
    } catch {
      if (devices.length) {
        devices = [];
        onDevices(devices);
      }
    } finally {
      polling = false;
    }
  }

  /** Polls now, and then every interval until stop(). The timer doesn't keep the app running. */
  function startPolling() {
    if (timer || !adbPath) return;
    poll();
    timer = setInterval(poll, interval);
    timer.unref?.();
  }

  /**
   * Starts a session with a device, over the cable or Wi-Fi as asked when the device has both, and otherwise the way
   * it has. Refuses a device whose app is in general mode. Pushes the stream server, starts it on a new socket name
   * with the bitrate and a new secret, waits up to eight seconds for it to print "ready", forwards a free local port to
   * its socket and connects, sending the secret first on every connection.
   *
   * Resolves with {device, socket, close, openFiles}: socket carries the stream (protocol.cjs), close() ends the
   * session on both sides, and openFiles() opens a file connection to the same server (files.cjs).
   */
  async function connect(id, transport, bitRate = 8_000_000) {
    const known = devices.find((entry) => entry.id === id);
    if (!known) throw Error('That device is no longer connected.');
    const via = known.connections[transport] ? transport : known.transport;
    const device = { ...known, transport: via, serial: known.connections[via] };
    if (await generalMode(device.serial)) throw generalError(device.name);
    if (!jarPath || !fs.existsSync(jarPath))
      throw Error('The Android stream server is missing from this build.');
    await adb(device.serial, 'push', jarPath, REMOTE);
    // app_process runs the server's main() in Android's runtime, as the shell user. It listens on a local socket
    // with a new random name for each session. Every connection to it starts with the session's secret, so nothing
    // else on the device can pass for this computer, even if it finds the socket.
    const name = `yes-machine-${crypto.randomBytes(6).toString('hex')}`;
    const secret = crypto.randomBytes(16);
    const command = [
      `CLASSPATH=${REMOTE}`,
      'app_process',
      '/',
      'local.yesmachine.stream.Server',
      name,
      bitRate,
      secret.toString('hex'),
    ].join(' ');
    const server = start(adbPath, ['-s', device.serial, 'shell', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // Everything the server prints is kept: it says "ready" once it listens, or explains why it didn't start.
    let output = '',
      failed = false;
    server.stdout.on('data', (chunk) => {
      output += chunk;
    });
    server.stderr.on('data', (chunk) => {
      output += chunk;
    });
    server.on('error', (error) => {
      failed = true;
      output += error.message;
    });
    for (let i = 0; i < 80 && !output.includes('ready') && server.exitCode === null && !failed; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (!output.includes('ready')) {
      server.kill();
      throw output.includes('general mode')
        ? generalError(device.name)
        : Error(`The device didn't start Yes Machine's stream. ${output.trim().slice(0, 200)}`);
    }
    // tcp:0 lets adb choose a free port on this computer, which it prints.
    let port;
    try {
      port = Number((await adb(device.serial, 'forward', 'tcp:0', `localabstract:${name}`)).trim());
      if (!Number.isInteger(port) || port <= 0) throw Error('adb gave no port.');
    } catch (error) {
      server.kill();
      throw error;
    }
    const socket = net.connect(port, '127.0.0.1');
    // Input messages are small, and each should go at once rather than wait to be sent with others.
    socket.setNoDelay(true);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }).catch((error) => {
      server.kill();
      throw error;
    });
    socket.write(secret);
    socket.on('error', () => {}); // a broken connection also closes, and closing ends the session
    let closed = false;
    const others = new Set();
    // Ends the session once: the stream and file connections, the server and the port forward. Either the
    // connection closing or the server exiting ends it.
    const close = () => {
      if (closed) return;
      closed = true;
      socket.destroy();
      for (const other of others) other.destroy();
      server.kill();
      adb(device.serial, 'forward', '--remove', `tcp:${port}`).catch(() => {});
    };
    socket.once('close', close);
    server.once('exit', close);
    // Files have a connection of their own to the same server, through the same forward. close() ends it too.
    const openFiles = () =>
      new Promise((resolve, reject) => {
        if (closed) {
          reject(Error('The session has ended.'));
          return;
        }
        const files = net.connect(port, '127.0.0.1');
        files.once('error', reject);
        files.once('connect', () => {
          files.write(secret);
          files.removeListener('error', reject);
          files.on('error', () => {});
          others.add(files);
          files.once('close', () => others.delete(files));
          if (closed) files.destroy();
          resolve(files);
        });
      });
    return { device, socket, close, openFiles };
  }

  /**
   * A PNG of the device's screen as it is now, taken by the device itself, so it is as sharp as the screen. exec-out
   * passes the bytes on unchanged, which shell doesn't promise. Rejects anything that isn't a PNG.
   */
  async function screenshot(id) {
    const device = devices.find((entry) => entry.id === id);
    if (!device) throw Error('That device is no longer connected.');
    const png = await new Promise((resolve, reject) =>
      run(
        adbPath,
        ['-s', device.serial, 'exec-out', 'screencap', '-p'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000, windowsHide: true },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    if (!Buffer.isBuffer(png) || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47)
      throw Error('The device sent no picture.');
    return png;
  }

  // Wi-Fi pairing: the QR code carries a one-time name and password. Once the device scans it in Wireless debugging,
  // it announces a pairing service under that name; adb pairs with it, and then connects to the device, on its own
  // or asked to. onState hears waiting, pairing, connecting, then ready with the device, or failed or expired.
  let pairing = null; // the pairing under way, if any

  /**
   * Starts a Wi-Fi pairing, as described above, and cancels the one before. The session's text is what the QR code
   * says, in the form Android's Wireless debugging scans. onState({state, ...}) hears 'waiting', 'pairing' and
   * 'connecting', then 'ready' (with the device's id, name and general flag), 'failed' (with a reason) or 'expired'
   * (no scan within three minutes). Returns {text, cancel()}; after cancel(), onState hears nothing more.
   */
  function pair(onState) {
    pairing?.cancel();
    const name = `yes-machine-${crypto.randomBytes(4).toString('hex')}`;
    const password = Array.from(
      crypto.randomBytes(12),
      (byte) => PASSWORD[byte % PASSWORD.length],
    ).join('');
    let cancelled = false;
    const session = {
      text: `WIFI:T:ADB;S:${name};P:${password};;`,
      cancel() {
        cancelled = true;
        if (pairing === session) pairing = null;
      },
    };
    pairing = session;
    const tell = (state, detail = {}) => {
      if (!cancelled) onState({ state, ...detail });
    };
    const services = async () => parseServices(await adb(null, 'mdns', 'services'));
    (async () => {
      // Wait for the device that scanned the code to announce its pairing service, looking every second.
      tell('waiting');
      const deadline = Date.now() + PAIRING_TIME;
      let service = null;
      while (!cancelled && !service) {
        if (Date.now() > deadline) {
          tell('expired');
          return;
        }
        service = (await services().catch(() => [])).find(
          (entry) => entry.name === name && entry.type === '_adb-tls-pairing._tcp',
        );
        if (!service) await sleep(1000);
      }
      if (cancelled) return;
      // adb answers "Successfully paired to <address> [guid=<guid>]", and the guid names the device's connect
      // service. When pairing fails, adb's output is read the same way, and has no guid.
      tell('pairing');
      const output = await adb(null, 'pair', service.address, password).catch((error) =>
        String(error.stdout || error.message),
      );
      const guid = /Successfully paired to \S+ \[guid=([^\]]+)\]/.exec(output)?.[1];
      if (!guid) {
        tell('failed', { reason: "The device didn't pair. Scan a new code." });
        return;
      }
      // Then up to twenty tries, a second apart, for the device to show up in `adb devices` over Wi-Fi. adb usually
      // connects to it on its own, under the connect service's name; if it hasn't by the fourth try, it is asked to
      // connect to the address the device announces.
      tell('connecting');
      for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
        const announced = (await services().catch(() => [])).find(
          (entry) => entry.name === guid && entry.type === '_adb-tls-connect._tcp',
        );
        await poll();
        const found = devices.find(
          (device) =>
            device.connections.wifi === `${guid}._adb-tls-connect._tcp` ||
            (announced && device.connections.wifi === announced.address),
        );
        if (found) {
          tell('ready', { id: found.id, name: found.name, general: found.general });
          return;
        }
        if (attempt === 3 && announced)
          await adb(null, 'connect', announced.address).catch(() => {});
        await sleep(1000);
      }
      tell('failed', {
        reason: "Paired, but the device didn't connect. Check that Wireless debugging is still on.",
      });
    })()
      .catch((error) => tell('failed', { reason: error.message }))
      .finally(() => {
        if (pairing === session) pairing = null;
      });
    return session;
  }

  return {
    startPolling,
    // Stops polling and cancels a pairing under way.
    stop() {
      clearInterval(timer);
      timer = null;
      pairing?.cancel();
    },
    devices: () => devices,
    connect,
    screenshot,
    pair,
    available: Boolean(adbPath),
  };
}

module.exports = { createAndroid, findAdb, parseDevices, groupDevices, parseServices, REMOTE };
