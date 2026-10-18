'use strict';

// Tests general mode for Android devices, the computer's side (src/main/android/general-mode.cjs): this computer's
// certificate for devices, approving a device's certificate, and the handshake in which the person at the device
// allows this computer or not. The device is a stand-in: a real TLS server on loopback that plays the Android app's
// ShareService. The trust store and the certificate file are real, in a temporary folder. The last test checks a
// screenshot helper from src/main/android/windows.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const selfsigned = require('selfsigned');
const {
  createAndroidShare,
  loadIdentity,
  hello,
  DENIED,
  ASKING,
  ALLOWED,
  BUSY,
} = require('../../src/main/android/general-mode.cjs');
const { createTrustStore } = require('../../src/main/network/trust.cjs');
const { checkedPicture } = require('../../src/main/android/windows.cjs');

/** A new temporary folder, removed when the test `t` ends. */
function tempDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-share-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// A stand-in for the Android app's ShareService: TLS with its own certificate, asking for the computer's, reading
// "YMC1" and the hello, then answering as each test says. answer(socket, visit) runs once the hello is complete, and
// `seen` collects each visit: the magic, the hello, the fingerprint of the computer's certificate, and a promise
// that resolves when the connection closes. Returns the port, the device's fingerprint and `seen`.
async function fakeDevice(t, answer) {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Yes Machine device' }], {
    keySize: 2048,
    days: 30,
  });
  const seen = [];
  const server = tls.createServer(
    { key: pems.private, cert: pems.cert, requestCert: true, rejectUnauthorized: false },
    (socket) => {
      socket.on('error', () => {});
      let buffer = Buffer.alloc(0),
        greeted = false;
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (greeted || buffer.length < 6 || buffer.length < 6 + buffer.readUInt16BE(4)) return;
        greeted = true;
        const visit = {
          magic: buffer.toString('latin1', 0, 4),
          hello: JSON.parse(buffer.toString('utf8', 6, 6 + buffer.readUInt16BE(4))),
          computer: socket.getPeerX509Certificate()?.fingerprint256,
          closed: new Promise((resolve) => socket.on('close', resolve)),
        };
        seen.push(visit);
        answer(socket, visit);
      });
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    port: server.address().port,
    fingerprint: new crypto.X509Certificate(pems.cert).fingerprint256,
    seen,
  };
}

/**
 * This computer's side of general mode, as "Office Mac", with a real trust store in `directory`. It knows the
 * stand-in device as discovery would list it, at 192.168.1.40, and its connections go to loopback instead.
 */
function share(t, device, directory = tempDirectory(t)) {
  const store = createTrustStore(path.join(directory, 'trusted-hosts.json'));
  const result = createAndroidShare({
    identityFile: path.join(directory, 'device-client.json'),
    store,
    name: 'Office Mac',
    system: 'macOS 27.0',
    connectTls: (options) => tls.connect({ ...options, host: '127.0.0.1' }),
  });
  result.setDevices([
    {
      id: 'tab._yes-machine-device._tcp.local',
      name: "Alejandro's Tab",
      address: '192.168.1.40',
      port: device.port,
      kind: 'tablet',
    },
  ]);
  return { share: result, store };
}
// The device's id, as discovery names it.
const ID = 'tab._yes-machine-device._tcp.local';
// A refusal from the device: its status, then the reason's length in two bytes, then the reason.
const refusal = (status, text) => {
  const reason = Buffer.from(text);
  return Buffer.concat([Buffer.from([status, reason.length >> 8, reason.length & 0xff]), reason]);
};

test('the hello carries the name and system after YMC1', () => {
  const bytes = hello('Office Mac', 'macOS 27.0');
  assert.equal(bytes.toString('latin1', 0, 4), 'YMC1');
  assert.deepEqual(JSON.parse(bytes.toString('utf8', 6)), {
    name: 'Office Mac',
    system: 'macOS 27.0',
  });
  assert.equal(bytes.readUInt16BE(4), bytes.length - 6);
});

test("this computer's certificate is made once and kept privately", async (t) => {
  const file = path.join(tempDirectory(t), 'nested', 'device-client.json');
  const first = await loadIdentity(file),
    second = await loadIdentity(file);
  assert.equal(second.cert, first.cert);
  assert.ok(
    new crypto.X509Certificate(first.cert).checkPrivateKey(crypto.createPrivateKey(first.key)),
  );
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a device's certificate must be approved, and only the one just seen can be", async (t) => {
  const device = await fakeDevice(t, () =>
    assert.fail('an unapproved device must not get a hello'),
  );
  const { share: client, store } = share(t, device);
  assert.throws(() => client.trust(ID), /Check the device again/);
  await assert.rejects(client.connect(ID), /haven’t verified/);
  const check = await client.inspect(ID);
  assert.deepEqual(check, { fingerprint: device.fingerprint, trusted: false, changed: false });
  client.trust(ID);
  assert.equal(store.get('192.168.1.40:' + device.port), device.fingerprint);
  assert.equal((await client.inspect(ID)).trusted, true);
  store.set('192.168.1.40:' + device.port, 'AA:' + Array(31).fill('01').join(':'));
  assert.deepEqual(await client.inspect(ID), {
    fingerprint: device.fingerprint,
    trusted: false,
    changed: true,
  });
  await assert.rejects(client.connect('gone'), /stopped sharing/);
});

test('the device asks, allows, and the stream that follows is kept for the viewer', async (t) => {
  const device = await fakeDevice(t, (socket) => {
    socket.write(Buffer.from([ASKING]));
    setTimeout(
      () => socket.write(Buffer.concat([Buffer.from([ALLOWED]), Buffer.from('YMS1stream')])),
      50,
    );
  });
  const { share: client } = share(t, device);
  await client.inspect(ID);
  client.trust(ID);
  let asked = 0;
  const session = await client.connect(ID, { onAsking: () => asked++ });
  assert.equal(asked, 1);
  const [visit] = device.seen;
  assert.equal(visit.magic, 'YMC1');
  assert.deepEqual(visit.hello, { name: 'Office Mac', system: 'macOS 27.0' });
  assert.match(
    visit.computer,
    /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    'the computer shows its own certificate',
  );
  const received = await new Promise((resolve) => {
    session.socket.once('data', resolve);
    session.socket.resume();
  });
  assert.equal(received.toString(), 'YMS1stream');
  session.close();
  await visit.closed;
});

test('a device that denies or is busy says so', async (t) => {
  for (const [status, expected] of [
    [DENIED, /Alejandro's Tab didn’t allow this computer/],
    [BUSY, /Another computer is using Alejandro's Tab/],
  ]) {
    const device = await fakeDevice(t, (socket) =>
      socket.write(Buffer.concat([Buffer.from([ASKING]), refusal(status, 'No.')])),
    );
    const { share: client } = share(t, device);
    await client.inspect(ID);
    client.trust(ID);
    await assert.rejects(client.connect(ID), expected);
  }
});

test('closing the window while the device asks cancels the request', async (t) => {
  const device = await fakeDevice(t, (socket) => socket.write(Buffer.from([ASKING])));
  const { share: client } = share(t, device);
  await client.inspect(ID);
  client.trust(ID);
  const cancel = new AbortController();
  const connecting = client.connect(ID, { onAsking: () => cancel.abort(), signal: cancel.signal });
  await assert.rejects(connecting, /Canceled/);
  await device.seen[0].closed;
});

test('a screenshot from the page must be a PNG', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.ok(checkedPicture(png).equals(Buffer.from(png)));
  assert.equal(checkedPicture(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(checkedPicture('not bytes'), null);
  assert.equal(checkedPicture(undefined), null);
});
