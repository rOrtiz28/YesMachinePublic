'use strict';

// Tests the store of certificates the user approved (src/main/network/trust.cjs). It writes real files in a temporary
// folder. The fingerprints are made up, in the format Node writes, except in the last test, which makes a real
// self-signed certificate.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const selfsigned = require('selfsigned');
const {
  createTrustStore,
  fingerprintOf,
  validTarget,
} = require('../../src/main/network/trust.cjs');

// Two made-up SHA-256 fingerprints: 32 hex bytes separated by colons.
const A = 'AA:' + Array(31).fill('01').join(':'),
  B = 'BB:' + Array(31).fill('02').join(':');

/**
 * A path for the store's file inside a folder that doesn't exist yet, in a new temporary folder that is removed when
 * the test `t` ends.
 */
function tempFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-trust-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'nested', 'trusted-hosts.json');
}

test('approved certificates persist privately across restarts', (t) => {
  const file = tempFile(t);
  createTrustStore(file).set('192.168.29.100:4777', A);
  const reloaded = createTrustStore(file);
  assert.equal(reloaded.get('192.168.29.100:4777'), A);
  assert.equal(reloaded.count(), 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  reloaded.clear();
  assert.equal(createTrustStore(file).count(), 0);
});

test('the viewer engine accepts only an approved fingerprint for that address', (t) => {
  const store = createTrustStore(tempFile(t));
  store.set('192.168.1.60:4777', A);
  assert.equal(store.allows('192.168.1.60', A), true);
  assert.equal(store.allows('192.168.1.60', B), false, 'changed certificate');
  assert.equal(store.allows('192.168.1.6', A), false, 'address prefix must not match');
  assert.equal(store.allows('192.168.1.61', A), false);
  assert.equal(store.allows('192.168.1.60', ''), false);
});

test('rejects public, malformed and tampered entries', (t) => {
  const file = tempFile(t),
    store = createTrustStore(file);
  assert.throws(() => store.set('8.8.8.8:443', A), /cannot be trusted/);
  assert.throws(() => store.set('192.168.1.60:4777', 'not-a-fingerprint'), /cannot be trusted/);
  assert.throws(() => store.set('192.168.1.60', A), /cannot be trusted/);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ '8.8.8.8:443': A, '192.168.1.60:4777': 'zz', '10.0.0.5:4777': B }),
  );
  const reloaded = createTrustStore(file);
  assert.equal(reloaded.count(), 1);
  assert.equal(reloaded.get('10.0.0.5:4777'), B);
  fs.writeFileSync(file, '{broken');
  assert.equal(createTrustStore(file).count(), 0);
});

test('fingerprints match the host certificate format and targets stay private', async () => {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Trust Test' }], {
    keySize: 2048,
    algorithm: 'sha256',
    days: 1,
  });
  assert.equal(fingerprintOf(pems.cert), new crypto.X509Certificate(pems.cert).fingerprint256);
  assert.equal(fingerprintOf('not a certificate'), '');
  assert.deepEqual(validTarget({ address: '192.168.29.100', port: 4777 }), {
    address: '192.168.29.100',
    port: 4777,
    key: '192.168.29.100:4777',
  });
  for (const bad of [
    { address: '8.8.8.8', port: 4777 },
    { address: 'host.local', port: 4777 },
    { address: '10.0.0.1', port: 0 },
    null,
  ])
    assert.equal(validTarget(bad), null);
});
