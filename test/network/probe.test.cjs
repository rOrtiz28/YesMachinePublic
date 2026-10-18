'use strict';

// Tests the check for whether computers are sharing right now (src/main/network/probe.cjs). Probes use a real TLS
// listener on loopback only: a server with a self-signed certificate made for the test, which closes each
// connection as soon as it opens. Nothing outside this computer is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { once } = require('node:events');
const selfsigned = require('selfsigned');
const { probeHosts, MAX_TARGETS } = require('../../src/main/network/probe.cjs');

/**
 * Starts the stand-in sharing computer on a free loopback port, closed when the test `t` ends. Returns its port and
 * its certificate's SHA-256 fingerprint.
 */
async function listener(t) {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Probe Test' }], {
    keySize: 2048,
    algorithm: 'sha256',
    days: 1,
  });
  const server = tls.createServer({ key: pems.private, cert: pems.cert }, (socket) => socket.end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return {
    port: server.address().port,
    fingerprint: new crypto.X509Certificate(pems.cert).fingerprint256,
  };
}

test('reports a sharing computer as online with its certificate fingerprint', async (t) => {
  const { port, fingerprint } = await listener(t);
  const [result] = await probeHosts([{ address: '127.0.0.1', port }]);
  assert.deepEqual(result, { address: '127.0.0.1', port, online: true, fingerprint });
});

test('reports a closed port as offline', async (t) => {
  const { port } = await listener(t);
  const [result] = await probeHosts(
    [{ address: '127.0.0.1', port: port === 65535 ? 65534 : port + 1 }],
    { timeout: 500 },
  );
  assert.equal(result.online, false);
});

test('never contacts public, malformed or out-of-range targets', async () => {
  const started = Date.now();
  const results = await probeHosts([
    { address: '8.8.8.8', port: 443 },
    { address: 'example.com', port: 443 },
    { address: '192.168.1.20', port: 0 },
    { address: '192.168.1.20', port: 70000 },
    null,
  ]);
  assert.ok(results.every((result) => result.online === false));
  assert.ok(Date.now() - started < 200, 'invalid targets resolve without network attempts');
});

test('limits how many computers one call can check', async () => {
  const targets = Array.from({ length: MAX_TARGETS + 1 }, () => ({
    address: '127.0.0.1',
    port: 1,
  }));
  await assert.rejects(probeHosts(targets), /at most/);
  await assert.rejects(probeHosts('127.0.0.1'), /at most/);
});
