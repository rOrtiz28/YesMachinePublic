'use strict';

// Tests advanced mode for Android devices (src/main/android/advanced-mode.cjs): reading what adb prints, listing the
// devices it reaches, starting a session with the stream server, screenshots, and Wi-Fi pairing. adb is a stand-in
// that answers each command as the test says and records it, and the stream server is a fake process. Only the
// session's connection is real, to a loopback listener that stands in for the forwarded port. One test checks how
// scripts/build-android-stream.cjs picks its Android SDK tools, with a made-up SDK in a temporary folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  createAndroid,
  findAdb,
  parseDevices,
  groupDevices,
  parseServices,
  REMOTE,
} = require('../../src/main/android/advanced-mode.cjs');
const { findTools, sortVersions } = require('../../scripts/build-android-stream.cjs');

// --- Finding adb and reading what it prints ---

test('adb devices output is read by tab, so serials with spaces survive', () => {
  const text = [
    '* daemon not running; starting now at tcp:5037',
    '* daemon started successfully',
    'List of devices attached',
    'R5TEST00001\tdevice',
    'adb-R5TEST00001-rBkcNZ (2)._adb-tls-connect._tcp\tdevice',
    '192.168.1.158:41235\toffline',
    'emulator-5554\tunauthorized\r',
    '',
  ].join('\n');
  assert.deepEqual(parseDevices(text), [
    { serial: 'R5TEST00001', state: 'device', transport: 'usb' },
    {
      serial: 'adb-R5TEST00001-rBkcNZ (2)._adb-tls-connect._tcp',
      state: 'device',
      transport: 'wifi',
    },
    { serial: '192.168.1.158:41235', state: 'offline', transport: 'wifi' },
    { serial: 'emulator-5554', state: 'unauthorized', transport: 'usb' },
  ]);
  assert.deepEqual(parseDevices('List of devices attached\n\n'), []);
});

test('a device reached both ways is listed once, by cable unless asked, and only ready devices are listed', () => {
  const tab = { id: 'R5TEST00001', name: "Alejandro's Tab A11+", system: 'Android 16' };
  const devices = groupDevices([
    {
      serial: 'adb-R5TEST00001-rBkcNZ._adb-tls-connect._tcp',
      state: 'device',
      transport: 'wifi',
      ...tab,
    },
    { serial: 'R5TEST00001', state: 'device', transport: 'usb', ...tab },
    {
      serial: 'PHONE',
      state: 'device',
      transport: 'wifi',
      id: 'PHONE',
      name: 'Acme phone',
      system: 'Android 15',
    },
    {
      serial: 'LOCKED',
      state: 'unauthorized',
      transport: 'usb',
      id: 'LOCKED',
      name: 'Locked',
      system: 'Android 14',
    },
    { serial: 'GONE', state: 'device', transport: 'usb' },
  ]);
  assert.deepEqual(
    devices.map((device) => [device.name, device.serial, device.transport]),
    [
      ['Acme phone', 'PHONE', 'wifi'],
      ["Alejandro's Tab A11+", 'R5TEST00001', 'usb'],
    ],
  );
  assert.deepEqual(devices[1].connections, {
    wifi: 'adb-R5TEST00001-rBkcNZ._adb-tls-connect._tcp',
    usb: 'R5TEST00001',
  });
});

test('adb mdns services is read by tab', () => {
  const text =
    'List of discovered mdns services\nadb-R5TEST00001-rBkcNZ\t_adb-tls-connect._tcp\t192.168.1.158:41235\n' +
    'yes-machine-1a2b3c4d\t_adb-tls-pairing._tcp\t192.168.1.158:37451\r\n\n';
  assert.deepEqual(parseServices(text), [
    {
      name: 'adb-R5TEST00001-rBkcNZ',
      type: '_adb-tls-connect._tcp',
      address: '192.168.1.158:41235',
    },
    { name: 'yes-machine-1a2b3c4d', type: '_adb-tls-pairing._tcp', address: '192.168.1.158:37451' },
  ]);
});

test('adb is found from the environment first, then where Android Studio puts it', () => {
  const home = '/Users/al',
    sdk = path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb');
  assert.equal(
    findAdb({ ADB: '/opt/adb' }, home, (file) => file === '/opt/adb' || file === sdk),
    '/opt/adb',
  );
  assert.equal(
    findAdb(
      { ANDROID_HOME: '/sdk' },
      home,
      (file) => file === path.join('/sdk', 'platform-tools', 'adb') || file === sdk,
    ),
    path.join('/sdk', 'platform-tools', 'adb'),
  );
  assert.equal(
    findAdb({}, home, (file) => file === sdk),
    sdk,
  );
  assert.equal(
    findAdb({ ADB: '/missing' }, home, () => false),
    null,
  );
});

// --- Listing devices ---

// A stand-in for the adb command: answers by its arguments, and records every call. answers(args) returns what adb
// prints, or an Error for a command that fails; `calls` holds each call's arguments joined by spaces.
function fakeAdb(answers) {
  const calls = [];
  const run = (file, args, _options, callback) => {
    calls.push(args.join(' '));
    const answer = answers(args);
    setImmediate(() => (answer instanceof Error ? callback(answer) : callback(null, answer ?? '')));
  };
  return { run, calls };
}

// The shell command that describes a device: its serial, model, Android version and its own name.
const DESCRIBE =
  'getprop ro.serialno; getprop ro.product.model; getprop ro.build.version.release; settings get global device_name';

test('polling describes each device once and reports changes only', async (t) => {
  let listing =
    'List of devices attached\nR5TEST00001\tdevice\nadb-R5TEST00001-x._adb-tls-connect._tcp\tdevice\n';
  const adb = fakeAdb((args) => {
    if (args[0] === 'devices') return listing;
    if (args.at(-1) === DESCRIBE) return "R5TEST00001\nSM-X230\n16\nAlejandro's Tab A11+\n";
    return new Error(`unexpected ${args.join(' ')}`);
  });
  const reports = [];
  const android = createAndroid({
    adbPath: '/adb',
    run: adb.run,
    onDevices: (devices) => reports.push(devices),
    interval: 20,
  });
  t.after(() => android.stop());
  assert.equal(android.available, true);
  android.startPolling();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], [
    {
      id: 'R5TEST00001',
      name: "Alejandro's Tab A11+",
      system: 'Android 16',
      general: false,
      transport: 'usb',
      serial: 'R5TEST00001',
      connections: { usb: 'R5TEST00001', wifi: 'adb-R5TEST00001-x._adb-tls-connect._tcp' },
    },
  ]);
  assert.equal(adb.calls.filter((call) => call.endsWith(DESCRIBE)).length, 2); // once per serial, not once per poll
  listing = 'List of devices attached\nadb-R5TEST00001-x._adb-tls-connect._tcp\tdevice\n';
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(reports.length, 2);
  assert.equal(reports[1][0].transport, 'wifi');
  assert.deepEqual(android.devices(), reports[1]);
});

test('a device without a name of its own goes by its model, and adb failing empties the list', async (t) => {
  let fail = false;
  const adb = fakeAdb((args) => {
    if (fail) return new Error('adb stopped');
    if (args[0] === 'devices') return 'List of devices attached\nABC\tdevice\n';
    return 'ABC\nPixel 9\n15\nnull\n';
  });
  const reports = [];
  const android = createAndroid({
    adbPath: '/adb',
    run: adb.run,
    onDevices: (devices) => reports.push(devices),
    interval: 20,
  });
  t.after(() => android.stop());
  android.startPolling();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(reports[0][0].name, 'Pixel 9');
  assert.equal(reports[0][0].system, 'Android 15');
  fail = true;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(reports.at(-1), []);
});

test('without adb there is nothing to poll', () => {
  const android = createAndroid({ adbPath: null, run: () => assert.fail('adb ran') });
  assert.equal(android.available, false);
  android.startPolling();
  assert.deepEqual(android.devices(), []);
});

// How the computer asks whether the device's Yes Machine app is in general mode, and the answer when it is: the app's
// ShareService answers the action.
const QUERY = 'cmd package query-services --brief -a local.yesmachine.android.SHARE_SCREEN';
const GENERAL =
  'Service #0:\n  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\n  local.yesmachine.android/.ShareService\n';

test('a device whose Yes Machine app is in general mode is marked, asked once per device, and left alone', async (t) => {
  let general = true;
  const adb = fakeAdb((args) => {
    if (args[0] === 'devices')
      return 'List of devices attached\nR5TEST00001\tdevice\nadb-R5TEST00001-x._adb-tls-connect._tcp\tdevice\n';
    if (args.at(-1) === DESCRIBE) return "R5TEST00001\nSM-X230\n16\nAlejandro's Tab A11+\n";
    if (args.join(' ').endsWith(QUERY)) return general ? GENERAL : 'No services found\n';
    return '';
  });
  const reports = [];
  const android = createAndroid({
    adbPath: '/adb',
    jarPath: __filename,
    run: adb.run,
    onDevices: (devices) => reports.push(devices),
    interval: 1000,
  });
  t.after(() => android.stop());
  android.startPolling();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(android.devices()[0].general, true);
  assert.equal(
    adb.calls.filter((call) => call.endsWith(QUERY)).length,
    1,
    'once for the device, not once per connection',
  );
  await assert.rejects(
    android.connect('R5TEST00001', 'usb'),
    /set to general mode in Yes Machine.*choose Advanced/,
  );
  assert.equal(
    adb.calls.some((call) => call.includes(' push ')),
    false,
    'nothing is pushed to a device in general mode',
  );
  general = false;
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.equal(reports.at(-1)[0].general, false, 'switching to advanced shows the device again');
});

// --- Sessions with the stream server ---

// The stream server as the device would run it: a process that prints "ready", reached through a local port. With
// `ready: false` it prints `said` on stderr and exits instead, and `listing` is what `adb devices` shows. Returns
// advanced mode, polling already (`android`), the stand-in adb, the servers started, the connections accepted on
// the forwarded port, and the path of the stand-in jar.
async function deviceSession(
  t,
  {
    ready = true,
    said = 'Exception in thread "main"',
    listing = 'List of devices attached\nR5TEST00001\tdevice\n',
  } = {},
) {
  const jar = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-android-')),
    'yes-machine-stream.jar',
  );
  fs.writeFileSync(jar, 'dex');
  t.after(() => fs.rmSync(path.dirname(jar), { recursive: true, force: true }));
  const accepted = [];
  const listener = net
    .createServer((socket) => {
      socket.resume();
      accepted.push(socket);
    })
    .listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  t.after(() => {
    for (const socket of accepted) socket.destroy();
    listener.close();
  });
  const adb = fakeAdb((args) => {
    if (args[0] === 'devices') return listing;
    if (args.at(-1) === DESCRIBE) return "R5TEST00001\nSM-X230\n16\nAlejandro's Tab A11+\n";
    if (args.includes('forward') && args.includes('tcp:0')) return `${listener.address().port}\n`;
    return '';
  });
  const started = [];
  const start = (file, args) => {
    const server = new EventEmitter();
    Object.assign(server, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      killed: false,
    });
    server.kill = () => {
      server.killed = true;
      return true;
    };
    started.push({ file, args, server });
    if (ready) server.stdout.write('ready\n');
    else
      setImmediate(() => {
        server.stderr.write(said);
        server.exitCode = 1;
        server.emit('exit', 1);
      });
    return server;
  };
  const android = createAndroid({
    adbPath: '/adb',
    jarPath: jar,
    run: adb.run,
    start,
    interval: 1000,
  });
  t.after(() => android.stop());
  android.startPolling();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { android, adb, started, accepted, jar };
}

test('connecting pushes the server, starts it under a fresh name, and forwards a port to it', async (t) => {
  const { android, adb, started, accepted, jar } = await deviceSession(t);
  const session = await android.connect('R5TEST00001', 'usb', 6_000_000);
  t.after(() => session.close());
  assert.equal(session.device.name, "Alejandro's Tab A11+");
  assert.ok(adb.calls.includes(`-s R5TEST00001 push ${jar} ${REMOTE}`));
  const [{ file, args }] = started;
  assert.equal(file, '/adb');
  const name = /local\.yesmachine\.stream\.Server (yes-machine-[0-9a-f]{12}) 6000000$/.exec(
    args.at(-1),
  )?.[1];
  assert.ok(name, args.at(-1));
  assert.deepEqual(args.slice(0, 3), ['-s', 'R5TEST00001', 'shell']);
  assert.ok(args.at(-1).startsWith(`CLASSPATH=${REMOTE} app_process / `));
  assert.ok(adb.calls.includes(`-s R5TEST00001 forward tcp:0 localabstract:${name}`));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(accepted.length, 1);
});

test('closing a session stops the device server and removes the port forward, once', async (t) => {
  const { android, adb, started, accepted } = await deviceSession(t);
  const session = await android.connect('R5TEST00001');
  await new Promise((resolve) => setTimeout(resolve, 20));
  session.close();
  session.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started[0].server.killed, true);
  assert.equal(session.socket.destroyed, true);
  assert.equal(adb.calls.filter((call) => call.includes('forward --remove')).length, 1);
  if (!accepted[0].destroyed) await new Promise((resolve) => accepted[0].once('close', resolve)); // the device side saw it end
});

test('the session ends when the device server exits or the connection drops', async (t) => {
  const { android, started, accepted } = await deviceSession(t);
  const first = await android.connect('R5TEST00001');
  started[0].server.emit('exit', 0);
  assert.equal(first.socket.destroyed, true);
  const second = await android.connect('R5TEST00001');
  await new Promise((resolve) => setTimeout(resolve, 20));
  accepted.at(-1).destroy();
  await new Promise((resolve) => second.socket.once('close', resolve));
  assert.equal(started[1].server.killed, true);
});

test('a server that fails to start is reported with what it printed', async (t) => {
  const { android } = await deviceSession(t, { ready: false });
  await assert.rejects(
    android.connect('R5TEST00001'),
    /didn't start Yes Machine's stream\. Exception in thread "main"/,
  );
});

test('a server that finds the app in general mode says so the same way the computer does', async (t) => {
  const { android } = await deviceSession(t, {
    ready: false,
    said: 'Yes Machine on this device is set to general mode.\n',
  });
  await assert.rejects(
    android.connect('R5TEST00001'),
    /Alejandro's Tab A11\+ is set to general mode in Yes Machine/,
  );
});

test('unknown devices and a missing server are refused before anything runs', async (t) => {
  const { android, adb } = await deviceSession(t);
  await assert.rejects(android.connect('NOPE'), /no longer connected/);
  const bare = createAndroid({ adbPath: '/adb', jarPath: '/missing.jar', run: adb.run });
  t.after(() => bare.stop());
  bare.startPolling();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(bare.connect('R5TEST00001'), /stream server is missing/);
});

// --- Building the stream server ---

test('the stream server builds against the oldest suitable platform with the newest d8', (t) => {
  assert.deepEqual(sortVersions(['android-37.1', 'android-34', 'android-36.1', 'android-36']), [
    'android-34',
    'android-36',
    'android-36.1',
    'android-37.1',
  ]);
  assert.deepEqual(sortVersions(['36.1.0', '30.0.3', '36.0.0', '9.0.0']), [
    '9.0.0',
    '30.0.3',
    '36.0.0',
    '36.1.0',
  ]);
  const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-sdk-'));
  t.after(() => fs.rmSync(sdk, { recursive: true, force: true }));
  for (const file of [
    'platforms/android-29/android.jar',
    'platforms/android-34/android.jar',
    'platforms/android-37.1/android.jar',
    'build-tools/30.0.3/lib/d8.jar',
    'build-tools/36.1.0/lib/d8.jar',
  ]) {
    fs.mkdirSync(path.dirname(path.join(sdk, file)), { recursive: true });
    fs.writeFileSync(path.join(sdk, file), '');
  }
  fs.mkdirSync(path.join(sdk, 'platforms', 'android-35')); // a platform folder without its library
  fs.mkdirSync(path.join(sdk, 'build-tools', '37.0.0')); // build tools without d8
  assert.deepEqual(findTools({ ANDROID_HOME: sdk }, '/nowhere'), {
    platform: path.join(sdk, 'platforms', 'android-34', 'android.jar'),
    d8: path.join(sdk, 'build-tools', '36.1.0', 'lib', 'd8.jar'),
  });
  assert.equal(findTools({}, '/nowhere'), null);
});

// --- Screenshots ---

test('a screenshot is a PNG the device takes of its own screen', async (t) => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('picture'),
  ]);
  let answer = png,
    seen = null;
  // adb that lists and describes one device, answers screencap with `answer`, and records how screencap was run.
  const run = (file, args, options, callback) => {
    if (args.includes('screencap')) seen = { args: args.join(' '), encoding: options.encoding };
    const reply =
      args[0] === 'devices'
        ? 'List of devices attached\nR5TEST00001\tdevice\n'
        : args.at(-1) === DESCRIBE
          ? "R5TEST00001\nSM-X230\n16\nAlejandro's Tab A11+\n"
          : args.includes('screencap')
            ? answer
            : '';
    setImmediate(() => callback(null, reply));
  };
  const android = createAndroid({ adbPath: '/adb', run, interval: 1000 });
  t.after(() => android.stop());
  android.startPolling();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(await android.screenshot('R5TEST00001'), png);
  assert.deepEqual(seen, { args: '-s R5TEST00001 exec-out screencap -p', encoding: 'buffer' });
  answer = Buffer.from('screencap: permission denied');
  await assert.rejects(android.screenshot('R5TEST00001'), /sent no picture/);
  await assert.rejects(android.screenshot('NOPE'), /no longer connected/);
});

// --- Wi-Fi: connecting and pairing ---

test('a device reached both ways connects over Wi-Fi when asked', async (t) => {
  const wifi = 'adb-R5TEST00001-x._adb-tls-connect._tcp';
  const { android, adb, started } = await deviceSession(t, {
    listing: `List of devices attached\nR5TEST00001\tdevice\n${wifi}\tdevice\n`,
  });
  const session = await android.connect('R5TEST00001', 'wifi');
  t.after(() => session.close());
  assert.equal(session.device.transport, 'wifi');
  assert.deepEqual(started[0].args.slice(0, 2), ['-s', wifi]);
  assert.ok(adb.calls.some((call) => call.startsWith(`-s ${wifi} push `)));
  const fallback = await android.connect('R5TEST00001', 'bluetooth');
  t.after(() => fallback.close());
  assert.equal(fallback.device.transport, 'usb');
});

test('Wi-Fi pairing finds the device that scanned the code, pairs with it, and waits for it to connect', async (t) => {
  let listing = 'List of devices attached\n',
    paired = false,
    services = 'List of discovered mdns services\n',
    scans = 0;
  const calls = [];
  // adb in which the device's pairing service appears on the second mDNS scan, as if the device had just scanned the
  // code, and pairing works only with the code's password; once paired, the device is listed over Wi-Fi.
  const run = (file, args, _options, callback) => {
    const command = args.join(' ');
    calls.push(command);
    let reply = '';
    if (command === 'devices') reply = listing;
    else if (args.at(-1) === DESCRIBE) reply = "R5TEST00001\nSM-X230\n16\nAlejandro's Tab A11+\n";
    else if (command === 'mdns services') {
      if (++scans === 2) services += `${name}\t_adb-tls-pairing._tcp\t192.168.1.158:37451\n`; // the device scanned the code
      reply = services;
    } else if (command.startsWith('pair ')) {
      paired = command === `pair 192.168.1.158:37451 ${password}`;
      if (paired) {
        services += 'adb-R5TEST00001-rBkcNZ\t_adb-tls-connect._tcp\t192.168.1.158:41235\n';
        listing += 'adb-R5TEST00001-rBkcNZ._adb-tls-connect._tcp\tdevice\n';
      }
      reply = paired
        ? 'Successfully paired to 192.168.1.158:37451 [guid=adb-R5TEST00001-rBkcNZ]\n'
        : 'Failed: Wrong password\n';
    }
    setImmediate(() => callback(null, reply));
  };
  const android = createAndroid({ adbPath: '/adb', run, interval: 60_000 });
  t.after(() => android.stop());
  const states = [];
  let name, password;
  const done = new Promise((resolve) => {
    const session = android.pair((state) => {
      states.push(state);
      if (['ready', 'failed', 'expired'].includes(state.state)) resolve();
    });
    [, name, password] =
      /^WIFI:T:ADB;S:(yes-machine-[0-9a-f]{8});P:([A-Za-z0-9]{12});;$/.exec(session.text) || [];
  });
  assert.ok(name && password, 'the code carries a one-time name and password');
  await done;
  assert.deepEqual(
    states.map((state) => state.state),
    ['waiting', 'pairing', 'connecting', 'ready'],
  );
  assert.deepEqual(states.at(-1), {
    state: 'ready',
    id: 'R5TEST00001',
    name: "Alejandro's Tab A11+",
    general: false,
  });
  assert.ok(
    paired,
    'adb paired with the address the device announced and the password in the code',
  );
});

test('a refused pairing is reported, and a cancelled one goes quiet', async (t) => {
  // adb in which a device is always waiting to pair with the code's name, and every pairing fails.
  const run = (file, args, _options, callback) =>
    setImmediate(() => {
      const command = args.join(' ');
      callback(
        null,
        command === 'mdns services'
          ? `List of discovered mdns services\n${session.text.split(';')[1].slice(2)}\t_adb-tls-pairing._tcp\t10.0.0.9:5000\n`
          : command.startsWith('pair ')
            ? 'Failed: Wrong password\n'
            : command === 'devices'
              ? 'List of devices attached\n'
              : '',
      );
    });
  const android = createAndroid({ adbPath: '/adb', run, interval: 60_000 });
  t.after(() => android.stop());
  const states = [];
  let session;
  await new Promise((resolve) => {
    session = android.pair((state) => {
      states.push(state);
      if (state.state === 'failed') resolve();
    });
  });
  assert.deepEqual(states.at(-1), {
    state: 'failed',
    reason: "The device didn't pair. Scan a new code.",
  });
  const quiet = [];
  const cancelled = android.pair((state) => quiet.push(state));
  cancelled.cancel();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(
    quiet.map((state) => state.state),
    ['waiting'],
  );
});
