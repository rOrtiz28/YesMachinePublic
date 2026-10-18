'use strict';

// Tests the sharing server (src/main/sharing/server.cjs): its TLS identity, the files it serves, sign-in and its
// tickets, the session socket, and files both ways. Integration tests use real TLS/WebSocket traffic on loopback
// only. Certificate verification is disabled for these temporary self-signed test identities only. The account
// check is a stand-in, and the public folder holds placeholder pages, except in the test that serves the real
// public/ folder. The last test also runs the desktop app's sign-in (src/main/viewing/signin.cjs) against it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createLanServer, credentials, LIMIT } = require('../../src/main/sharing/server.cjs');

/** Waits until predicate() is true, looking every 10 ms for up to 2 seconds; then fails, naming `label`. */
async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * POSTs `body` to the server's /login, as JSON (a string is sent as it is), and resolves with the status and the
 * parsed answer.
 */
function signIn(server, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${server.url}/login`,
      {
        method: 'POST',
        rejectUnauthorized: false,
        agent: false,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}
// The stand-in for the check against this computer's accounts: only alex, with "correct horse", signs in.
const account = (user, password) =>
  Promise.resolve(user === 'alex' && password === 'correct horse');

/** Signs in as alex and returns the one-time ticket. */
async function ticketFor(server) {
  const response = await signIn(server, { user: 'alex', password: 'correct horse' });
  assert.equal(response.status, 200);
  return response.body.ticket;
}

/**
 * Starts a server on a free loopback port, with its identity in a temporary folder and a public folder of
 * placeholder pages; `extra` overrides any option. It records what the server reports: viewers joining and leaving
 * (`peers`), signaling (`signals`), and finished uploads with their bytes (`uploads`). The server stops and the
 * folder is removed when the test `t` ends.
 */
async function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-test-'));
  const publicDirectory = path.join(root, 'public');
  const directory = path.join(root, 'identity');
  fs.mkdirSync(publicDirectory);
  for (const file of ['client.html', 'style.css'])
    fs.writeFileSync(path.join(publicDirectory, file), `Test ${file}`);
  const peers = [],
    signals = [],
    uploads = [];
  let server;
  t.after(async () => {
    if (server) await server.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  server = await createLanServer({
    address: '127.0.0.1',
    port: 0,
    directory,
    publicDirectory,
    hostName: 'Test Host',
    platform: 'test',
    authenticate: account,
    onPeer: (value) => peers.push(value),
    onSignal: (value) => signals.push(value),
    onUpload: (value) => uploads.push({ ...value, bytes: fs.readFileSync(value.path) }),
    ...extra,
  });
  return { server, peers, signals, uploads, root, directory };
}

/** An HTTPS request to `url`; resolves with the status, the headers and the body as text. */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { rejectUnauthorized: false, agent: false, ...options },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Opens the session socket as the viewer page would, from the server's own origin. Returns the socket, the messages
 * received and not yet taken, next(type), which waits up to 3 seconds for the first message of that type and takes
 * it, and send(value), which sends `value` as JSON.
 */
async function client(t, server, overrides = {}) {
  const ws = new WebSocket(`${server.url.replace('https:', 'wss:')}/session`, {
    rejectUnauthorized: false,
    origin: server.url,
    ...overrides,
  });
  const messages = [];
  const listeners = new Set();
  ws.on('error', () => {});
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const listener of [...listeners]) listener();
  });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  function next(type) {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        listeners.delete(check);
        reject(Error(`No ${type} message received`));
      }, 3000);
      function check() {
        const index = messages.findIndex((message) => message.type === type);
        if (index !== -1) {
          clearTimeout(deadline);
          listeners.delete(check);
          resolve(messages.splice(index, 1)[0]);
        }
      }
      listeners.add(check);
      check();
    });
  }
  return { ws, messages, next, send: (value) => ws.send(JSON.stringify(value)) };
}

/** A viewer that signed in and spent its ticket on the session socket, so the server paired it. */
async function paired(t, server) {
  const ticket = await ticketFor(server);
  const peer = await client(t, server);
  peer.send({ type: 'ticket', ticket });
  assert.deepEqual(await peer.next('paired'), {
    type: 'paired',
    hostName: 'Test Host',
    platform: 'test',
  });
  return peer;
}

/**
 * Tries to open the session socket with `options` and resolves with the HTTP status the server refused it with. It
 * fails if the socket opens, or if nothing happens within 2 seconds.
 */
async function rejectUpgrade(t, server, options) {
  const ws = new WebSocket(`${server.url.replace('https:', 'wss:')}/session`, {
    rejectUnauthorized: false,
    origin: server.url,
    ...options,
  });
  ws.on('error', () => {});
  t.after(() => ws.terminate());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Upgrade was not rejected')), 2000);
    ws.on('open', () => {
      clearTimeout(timeout);
      reject(Error('Unexpected successful upgrade'));
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timeout);
      res.resume();
      ws.terminate();
      resolve(res.statusCode);
    });
  });
}

// The temporary files that uploads are written to, in the server's folder.
const incoming = (directory) =>
  fs.readdirSync(directory).filter((file) => file.startsWith('incoming-'));
// An ICE host candidate for `address`.
const candidate = (address) => `candidate:1 1 udp 2122260223 ${address} 50000 typ host`;

// --- The TLS identity ---

test('TLS identity persists across restart with private key file permissions', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = await credentials(directory, '127.0.0.1');
  const second = await credentials(directory, '127.0.0.1');
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.key, second.key);
  assert.equal(new crypto.X509Certificate(first.cert).checkIP('127.0.0.1'), '127.0.0.1');
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(path.join(directory, 'identity.json')).mode & 0o777, 0o600);
});

test('each address keeps its own certificate, so moving between networks and back keeps it', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wifi = await credentials(directory, '192.168.1.52');
  const ethernet = await credentials(directory, '192.168.1.60');
  assert.notEqual(wifi.fingerprint, ethernet.fingerprint);
  assert.equal(new crypto.X509Certificate(ethernet.cert).checkIP('192.168.1.60'), '192.168.1.60');
  assert.equal((await credentials(directory, '192.168.1.52')).fingerprint, wifi.fingerprint);
  for (const address of ['10.0.0.2', '10.0.0.3', '10.0.0.4']) await credentials(directory, address);
  assert.equal((await credentials(directory, '192.168.1.52')).fingerprint, wifi.fingerprint);
  assert.notEqual(
    (await credentials(directory, '192.168.1.60')).fingerprint,
    ethernet.fingerprint,
    'only four addresses are kept',
  );
});

test('an identity saved by an earlier version is kept', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = await credentials(directory, '127.0.0.1');
  fs.writeFileSync(
    path.join(directory, 'identity.json'),
    JSON.stringify({ address: '127.0.0.1', key: first.key, cert: first.cert }),
  );
  assert.equal((await credentials(directory, '127.0.0.1')).fingerprint, first.fingerprint);
  assert.ok(
    JSON.parse(fs.readFileSync(path.join(directory, 'identity.json'), 'utf8')).identities ===
      undefined,
    'an unchanged identity is not rewritten',
  );
});

// --- Serving the viewer page ---

test('HTTPS serves local assets with security headers and rejects host spoofing', async (t) => {
  const { server } = await fixture(t);
  const page = await request(`${server.url}/`);
  assert.equal(page.status, 200);
  assert.equal(page.body, 'Test client.html');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal((await request(`${server.url}/`, { headers: { Host: 'evil.test' } })).status, 403);
  assert.equal((await request(`${server.url}/identity.json`)).status, 404);
  assert.equal((await request(`${server.url}/`, { method: 'POST' })).status, 404);
  assert.equal(await rejectUpgrade(t, server, { origin: 'https://evil.test' }), 403);
  assert.equal(await rejectUpgrade(t, server, { headers: { Host: 'evil.test' } }), 403);
});

test('the viewer page gets its pixel art scripts, keyboard rules and bundled fonts, and nothing else from the folder', async (t) => {
  const publicDirectory = path.join(__dirname, '../../public');
  const { server } = await fixture(t, { publicDirectory });
  const expected = {
    '/pixel-icons.js': 'text/javascript',
    '/pixel-scene.js': 'text/javascript',
    '/keys.js': 'text/javascript',
    '/fonts/pixelify-sans-latin-700-normal.woff2': 'font/woff2',
    '/fonts/jetbrains-mono-latin-400-normal.woff2': 'font/woff2',
  };
  for (const [file, type] of Object.entries(expected)) {
    const response = await request(`${server.url}${file}`);
    assert.equal(response.status, 200, file);
    assert.ok(response.headers['content-type'].startsWith(type), file);
  }
  const page = (await request(`${server.url}/`)).body;
  // Every script the page loads, its own (public/client/) included.
  for (const [, file] of page.matchAll(/<script src="([^"]+)"/g)) {
    const response = await request(`${server.url}${file}`);
    assert.equal(response.status, 200, file);
    assert.ok(response.headers['content-type'].startsWith('text/javascript'), file);
  }
  for (const font of page.match(/\/fonts\/[\w-]+\.woff2/g) || [])
    assert.equal((await request(`${server.url}${font}`)).status, 200, font);
  const styles = (await request(`${server.url}/style.css`)).body;
  for (const font of styles.match(/\/fonts\/[\w-]+\.woff2/g))
    assert.equal((await request(`${server.url}${font}`)).status, 200, font);
  for (const file of ['/fonts/OFL-PixelifySans.txt', '/fonts/', '/pixel-house.js']) {
    assert.equal((await request(`${server.url}${file}`)).status, 404, file);
  }
});

// --- Who gets the session, and what it lets through ---

test('signing in gates signals and file access, refuses a PIN, and a newer sign-in takes over', async (t) => {
  const { server, peers, signals, directory } = await fixture(t);
  const first = await client(t, server);
  first.send({ type: 'file-start', name: 'x', size: 1 });
  assert.match((await first.next('error')).message, /Sign in to connect/);
  first.send({ type: 'ice', candidate: { candidate: candidate('192.168.1.10') } });
  assert.match((await first.next('error')).message, /Sign in to connect/);
  first.send({ type: 'pair', code: '123456' });
  assert.match((await first.next('error')).message, /Sign in to connect/);
  assert.deepEqual(incoming(directory), []);
  assert.deepEqual(signals, []);
  first.send({ type: 'ticket', ticket: await ticketFor(server) });
  await first.next('paired');
  assert.ok(server.viewerId);
  assert.equal(peers.filter((peer) => peer.type === 'viewer-joined').length, 1);
  const firstId = server.viewerId;
  const second = await client(t, server);
  const firstClosed = once(first.ws, 'close');
  second.send({ type: 'ticket', ticket: await ticketFor(server) });
  await second.next('paired');
  assert.deepEqual(await first.next('replaced'), { type: 'replaced' });
  const [code] = await firstClosed;
  assert.equal(code, 4000);
  assert.ok(server.viewerId && server.viewerId !== firstId);
  assert.deepEqual(
    peers.filter((peer) => peer.type === 'viewer-left').map((peer) => peer.id),
    [firstId],
  );
  const joined = peers.filter((peer) => peer.type === 'viewer-joined');
  assert.deepEqual(
    joined.map((peer) => peer.replaced),
    [false, true],
  );
  assert.equal(joined[1].id, server.viewerId);
});

test('host readiness is enforced before a viewer can connect', async (t) => {
  let ready = false;
  const { server } = await fixture(t, { isReady: () => ready });
  const early = await signIn(server, { user: 'alex', password: 'correct horse' });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /not sharing yet/);
  ready = true;
  const ticket = await ticketFor(server);
  ready = false;
  const peer = await client(t, server);
  peer.send({ type: 'ticket', ticket });
  assert.match((await peer.next('error')).message, /not sharing yet/);
  assert.equal(server.viewerId, undefined);
});

test('five failed sign-ins spend the minute budget, then it recovers', async (t) => {
  let now = 1700000000000;
  const { server } = await fixture(t, { now: () => now });
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await signIn(server, { user: 'alex', password: 'guess' })).status, 401);
  assert.equal((await signIn(server, { user: 'alex', password: 'correct horse' })).status, 429);
  now += 60000;
  await paired(t, server);
  assert.ok(server.viewerId);
});

test('public and relayed ICE candidates are rejected inbound and outbound', async (t) => {
  const { server, signals } = await fixture(t);
  const peer = await paired(t, server);
  peer.send({ type: 'ice', candidate: { candidate: candidate('8.8.8.8') } });
  assert.match((await peer.next('error')).message, /private-network/);
  peer.send({
    type: 'answer',
    sdp: {
      type: 'answer',
      sdp: `v=0\r\na=${candidate('192.168.1.5').replace('typ host', 'typ relay')}\r\n`,
    },
  });
  assert.match((await peer.next('error')).message, /private-network/);
  assert.deepEqual(signals, []);
  const valid = { type: 'ice', candidate: { candidate: candidate('192.168.1.10') } };
  peer.send(valid);
  await waitFor(() => signals.length === 1, 'private candidate forwarding');
  assert.deepEqual(signals[0], { id: server.viewerId, message: valid });
  server.signal(server.viewerId, { type: 'ice', candidate: { candidate: candidate('8.8.8.8') } });
  server.signal(server.viewerId, valid);
  assert.deepEqual(await peer.next('ice'), valid);
});

// --- Files from the viewer ---

test('file uploads enforce sizes and sanitize names while preserving exact bytes', async (t) => {
  const { server, directory, uploads } = await fixture(t);
  const peer = await paired(t, server);
  for (const size of [-1, 0.5, '10', LIMIT + 1]) {
    peer.send({ type: 'file-start', name: 'bad.txt', size });
    assert.match((await peer.next('error')).message, /10 GB/);
    assert.deepEqual(incoming(directory), []);
  }
  const data = Buffer.from([0, 1, 255, 128, 13, 10, 42]);
  peer.send({ type: 'file-start', name: '../../outside.bin', size: data.length });
  const { id } = await peer.next('file-ready');
  peer.send({ type: 'file-chunk', id, data: data.subarray(0, 3).toString('base64') });
  peer.send({ type: 'file-chunk', id, data: data.subarray(3).toString('base64') });
  peer.send({ type: 'file-end', id });
  const finished = await peer.next('file-done');
  assert.doesNotMatch(finished.name, /[\\/]|^\./);
  assert.equal(uploads.length, 1);
  assert.equal(path.dirname(uploads[0].path), directory);
  assert.equal(uploads[0].name, finished.name);
  assert.deepEqual(uploads[0].bytes, data);
  await waitFor(() => incoming(directory).length === 0, 'completed upload cleanup');
});

test('a file that would fill the disk is refused before anything is written', async (t) => {
  const { server, directory } = await fixture(t, { freeSpace: () => 300 * 1024 * 1024 });
  const peer = await paired(t, server);
  peer.send({ type: 'file-start', name: 'big.bin', size: 100 * 1024 * 1024 });
  assert.match((await peer.next('error')).message, /doesn’t have room/);
  assert.deepEqual(incoming(directory), []);
  peer.send({ type: 'file-start', name: 'small.bin', size: 1024 });
  assert.ok((await peer.next('file-ready')).id, 'what leaves room is accepted');
});

test('invalid chunks, incomplete uploads, and disconnect remove temporary files', async (t) => {
  const { server, directory, uploads } = await fixture(t);
  const peer = await paired(t, server);
  for (const message of [
    (id) => ({ type: 'file-chunk', id, data: '*invalid base64*' }),
    (id) => ({ type: 'file-chunk', id, data: Buffer.from('toolong').toString('base64') }),
    (id) => ({ type: 'file-end', id }),
  ]) {
    peer.send({ type: 'file-start', name: 'part.txt', size: 2 });
    const { id } = await peer.next('file-ready');
    assert.equal(incoming(directory).length, 1);
    peer.send(message(id));
    await peer.next('error');
    assert.deepEqual(incoming(directory), []);
  }
  peer.send({ type: 'file-start', name: 'interrupted.txt', size: 100 });
  await peer.next('file-ready');
  peer.ws.terminate();
  await waitFor(
    () => incoming(directory).length === 0 && !server.viewerId,
    'disconnected upload cleanup',
  );
  assert.deepEqual(uploads, []);
});

// --- Files from the host ---

// What a viewer's browser does with an offered file: takes its one-time address, from the session's own address.
// Resolves with the status, the headers and the body as bytes.
function take(server, offerPath, extra = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${server.url}${offerPath}`,
      { rejectUnauthorized: false, agent: false, ...extra },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('a file the host sends is offered once, at an address only the viewer can take, with its bytes and name', async (t) => {
  const { server, root } = await fixture(t);
  const peer = await paired(t, server);
  const data = crypto.randomBytes(700000);
  const file = path.join(root, 'résumé 2026.bin');
  fs.writeFileSync(file, data);
  const sending = server.sendFile(file);
  const offer = await peer.next('download-offer');
  assert.equal(offer.name, 'résumé 2026.bin');
  assert.equal(offer.size, data.length);
  assert.match(offer.path, /^\/download\/[0-9a-f]{48}$/);
  assert.equal(
    (await take(server, `/download/${'0'.repeat(48)}`)).status,
    404,
    'an address never offered',
  );
  const taken = await take(server, offer.path);
  assert.equal(taken.status, 200);
  assert.ok(taken.body.equals(data), 'exact bytes');
  assert.equal(taken.headers['content-length'], String(data.length));
  assert.equal(
    taken.headers['content-disposition'],
    'attachment; filename="r_sum_ 2026.bin"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%202026.bin',
  );
  assert.equal(taken.headers['cache-control'], 'no-store');
  assert.equal((await peer.next('download-end')).id, offer.id);
  await sending;
  assert.equal((await take(server, offer.path)).status, 404, 'the address works once');
});

test('an offer goes away when the viewer leaves, and is refused to anyone but the viewer', async (t) => {
  const { server, root } = await fixture(t);
  const peer = await paired(t, server);
  const file = path.join(root, 'later.bin');
  fs.writeFileSync(file, crypto.randomBytes(1000));
  const sending = server.sendFile(file);
  const offer = await peer.next('download-offer');
  await assert.rejects(server.sendFile(file), /Finish sending the current file first/);
  peer.ws.close();
  await assert.rejects(sending, /Viewer disconnected/);
  assert.equal((await take(server, offer.path)).status, 404, 'the offer left with the viewer');
  const next = await paired(t, server);
  const again = server.sendFile(file);
  const second = await next.next('download-offer');
  server.disconnect();
  await assert.rejects(again, /Viewer disconnected/);
  assert.equal(
    (await take(server, second.path)).status,
    404,
    'a viewer that no longer holds the session gets nothing',
  );
});

// --- Ending sessions ---

test('host disconnect immediately revokes authorization, then stop terminates all sessions', async (t) => {
  const { server, directory, peers } = await fixture(t);
  const peer = await paired(t, server);
  peer.send({ type: 'file-start', name: 'pending', size: 50 });
  await peer.next('file-ready');
  const closed = once(peer.ws, 'close');
  server.disconnect();
  assert.equal(server.viewerId, undefined);
  await closed;
  await waitFor(() => incoming(directory).length === 0, 'host disconnect cleanup');
  assert.equal(peers.filter((item) => item.type === 'viewer-left').length, 1);
  const next = await paired(t, server);
  const stopped = once(next.ws, 'close');
  await server.stop();
  await stopped;
  assert.equal(server.viewerId, undefined);
  await assert.rejects(server.sendFile(path.join(directory, 'missing')), /Connect a viewer/);
  await assert.rejects(request(`${server.url}/`));
});

// --- Signing in with this computer's account ---

test('signing in with the computer account returns a ticket that opens exactly one session', async (t) => {
  const { server, peers } = await fixture(t, { authenticate: account });
  assert.equal((await signIn(server, { user: 'alex', password: 'wrong' })).status, 401);
  const ok = await signIn(server, { user: 'alex', password: 'correct horse' });
  assert.equal(ok.status, 200);
  assert.match(ok.body.ticket, /^[0-9a-f]{64}$/);
  const peer = await client(t, server);
  peer.send({ type: 'ticket', ticket: ok.body.ticket });
  assert.deepEqual(await peer.next('paired'), {
    type: 'paired',
    hostName: 'Test Host',
    platform: 'test',
  });
  await waitFor(() => peers.some((p) => p.type === 'viewer-joined'), 'viewer joined');
  const replay = await client(t, server);
  replay.send({ type: 'ticket', ticket: ok.body.ticket });
  assert.match((await replay.next('error')).message, /Sign in again/);
});

test('sign-in rejects foreign origins, malformed requests, hosts without it, and too many attempts', async (t) => {
  const { server } = await fixture(t, { authenticate: account });
  assert.equal(
    (
      await signIn(
        server,
        { user: 'alex', password: 'correct horse' },
        { Origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await signIn(
        server,
        { user: 'alex', password: 'correct horse' },
        { 'Content-Type': 'text/plain' },
      )
    ).status,
    415,
  );
  assert.equal((await signIn(server, '{not json')).status, 400);
  assert.equal((await signIn(server, { user: 'alex' })).status, 400);
  assert.equal((await signIn(server, { user: 'a'.repeat(65), password: 'x' })).status, 400);
  for (let i = 0; i < 5; i++)
    assert.equal((await signIn(server, { user: 'alex', password: 'guess' })).status, 401);
  assert.equal(
    (await signIn(server, { user: 'alex', password: 'correct horse' })).status,
    429,
    'the minute budget is spent',
  );
  const { server: withoutSignIn } = await fixture(t, { authenticate: null });
  assert.equal(
    (await signIn(withoutSignIn, { user: 'alex', password: 'correct horse' })).status,
    404,
  );
});

test('sign-in tickets expire after one minute and unknown tickets never pair', async (t) => {
  let time = Date.now();
  const { server } = await fixture(t, { authenticate: account, now: () => time });
  const ok = await signIn(server, { user: 'alex', password: 'correct horse' });
  time += 61000;
  const late = await client(t, server);
  late.send({ type: 'ticket', ticket: ok.body.ticket });
  assert.match((await late.next('error')).message, /Sign in again/);
  late.send({ type: 'ticket', ticket: 'f'.repeat(64) });
  assert.match((await late.next('error')).message, /Sign in again/);
  late.send({ type: 'ticket', ticket: { forged: true } });
  assert.match((await late.next('error')).message, /Sign in again/);
});

test('the desktop sign-in sends the password only to the approved certificate', async (t) => {
  const tried = [];
  const { server } = await fixture(t, {
    authenticate: async (user, password) => {
      tried.push(password);
      return password === 'correct horse';
    },
  });
  const { requestTicket } = require('../../src/main/viewing/signin.cjs');
  const target = { address: '127.0.0.1', port: Number(new URL(server.url).port) };
  assert.match(
    await requestTicket(target, server.fingerprint, 'alex', 'correct horse'),
    /^[0-9a-f]{64}$/,
  );
  await assert.rejects(
    requestTicket(target, server.fingerprint, 'alex', 'wrong'),
    (error) => error.status === 401 && /not correct/.test(error.message),
  );
  const impostor = 'AA:' + Array(31).fill('00').join(':');
  await assert.rejects(
    requestTicket(target, impostor, 'alex', 'never sent'),
    /certificate changed/,
  );
  assert.deepEqual(
    tried,
    ['correct horse', 'wrong'],
    'a mismatched certificate never receives the password',
  );
});
