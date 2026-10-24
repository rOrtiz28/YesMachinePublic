'use strict';

// Tests the in-app viewer's remembered sign-ins (src/main/viewing/credentials.cjs). The store writes real files in a
// temporary folder. Electron's safeStorage is a stand-in whose "encryption" is a tag and hex, enough to show that a
// password never reaches the file as plain text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCredentialStore } = require('../../src/main/viewing/credentials.cjs');

// Stands in for Electron's safeStorage; the real one encrypts with the operating system's keychain. `available` says
// whether encryption works, and `backend` is the storage Linux reports using (basic_text is plain text).
function keychain({ available = true, backend = 'gnome_libsecret' } = {}) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('hex')}`),
    decryptString: (data) => Buffer.from(data.toString().replace(/^sealed:/, ''), 'hex').toString(),
  };
}
/** A path for the store's file, in a new temporary folder that is removed when the test `t` ends. */
function tempFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-credentials-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'credentials.json');
}

test('remembered sign-ins are stored encrypted, privately, and survive a restart', (t) => {
  const file = tempFile(t),
    storage = keychain();
  assert.equal(
    createCredentialStore(file, storage, 'darwin').set('192.168.1.60:4777', {
      user: 'alex',
      password: 'correct horse',
    }),
    true,
  );
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('correct horse'), 'the password is never written in plain text');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const reloaded = createCredentialStore(file, storage, 'darwin');
  assert.deepEqual(reloaded.get('192.168.1.60:4777'), { user: 'alex', password: 'correct horse' });
  reloaded.forget('192.168.1.60:4777');
  assert.equal(createCredentialStore(file, storage, 'darwin').get('192.168.1.60:4777'), null);
});

test('nothing is remembered without real encryption, including Linux plain-text storage', (t) => {
  for (const [storage, platform] of [
    [keychain({ available: false }), 'darwin'],
    [keychain({ backend: 'basic_text' }), 'linux'],
  ]) {
    const file = tempFile(t),
      store = createCredentialStore(file, storage, platform);
    assert.equal(store.available(), false);
    assert.equal(store.set('10.0.0.5:4777', { user: 'alex', password: 'pw' }), false);
    assert.equal(fs.existsSync(file), false);
  }
});

test("Settings' list has each sign-in's account, computer and time, and never the password", (t) => {
  const file = tempFile(t),
    store = createCredentialStore(file, keychain(), 'darwin', () => 1_760_000_000_000);
  store.set('10.0.0.5:4777', { user: 'alex', password: 'secret' }, 'Studio Mac');
  assert.deepEqual(createCredentialStore(file, keychain(), 'darwin').list(), [
    { key: '10.0.0.5:4777', user: 'alex', name: 'Studio Mac', since: 1_760_000_000_000 },
  ]);
  // One saved by an earlier version has only the user and the secret.
  fs.writeFileSync(file, JSON.stringify({ '10.0.0.6:4777': { user: 'sam', secret: 'x' } }));
  assert.deepEqual(createCredentialStore(file, keychain(), 'darwin').list(), [
    { key: '10.0.0.6:4777', user: 'sam', name: '', since: 0 },
  ]);
});

test('clearing forgets every remembered sign-in, and broken files start empty', (t) => {
  const file = tempFile(t),
    store = createCredentialStore(file, keychain(), 'linux');
  store.set('10.0.0.5:4777', { user: 'alex', password: 'a' });
  store.set('10.0.0.6:4777', { user: 'sam', password: 'b' });
  assert.equal(store.count(), 2);
  store.clear();
  assert.equal(createCredentialStore(file, keychain(), 'linux').count(), 0);
  fs.writeFileSync(file, '{broken');
  assert.equal(createCredentialStore(file, keychain(), 'linux').count(), 0);
});
