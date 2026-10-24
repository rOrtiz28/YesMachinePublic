'use strict';
// Remembered sign-ins for the in-app viewer: a user name and password for each computer, by its
// "address:port" key. Passwords are encrypted with the operating system's keychain through
// Electron's safeStorage, and nothing is saved when only plain-text storage is available. User
// names are saved as they are, with the computer's name and the time, for Settings' list; earlier
// versions kept neither, and those entries load without them.
//
// viewing/viewer.cjs is the only user; main.cjs gives it the file, remembered-sign-ins.json in the
// app's data folder, which is written privately (system/private-json.cjs).
const { readJson, writePrivateJson } = require('../system/private-json.cjs');
const { cutText } = require('../network/security.cjs');

/**
 * Opens the store saved in `file`. `safeStorage` is Electron's (tests pass a stand-in), and `now`
 * gives the time unless a test passes its own. Entries without a string user and secret are
 * dropped as it loads. Returns:
 * - available(): whether passwords can be saved encrypted.
 * - get(key): { user, password }, or null when there is none, encryption isn't available, or the
 *   password can't be decrypted.
 * - set(key, { user, password }, name): saves it, with the computer's name, and returns true, or
 *   returns false without saving when encryption isn't available.
 * - list(): every sign-in, as { key, user, name, since }, without decrypting anything.
 * - forget(key), clear(): forget one sign-in, or all of them.
 * - count(): how many are saved.
 */
function createCredentialStore(file, safeStorage, platform = process.platform, now = Date.now) {
  // By key: { user, secret, name, since }, where secret is the encrypted password in base64 and
  // since the time it was saved in milliseconds, or 0 when it isn't known.
  let entries = {};
  for (const [key, entry] of Object.entries(readJson(file, {}) || {}))
    if (typeof entry?.user === 'string' && typeof entry?.secret === 'string') {
      const since = Number(entry.since);
      entries[key] = {
        user: entry.user,
        secret: entry.secret,
        name: typeof entry.name === 'string' ? entry.name : '',
        since: Number.isSafeInteger(since) && since > 0 ? since : 0,
      };
    }
  const save = () => writePrivateJson(file, entries);
  // On Linux without a keyring, safeStorage falls back to the "basic_text" backend, which
  // encrypts with a fixed key anyone can know. That doesn't count as encryption here.
  const available = () =>
    safeStorage.isEncryptionAvailable() &&
    !(platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text');
  return {
    available,
    get(key) {
      const entry = entries[key];
      if (!entry || !available()) return null;
      try {
        return {
          user: entry.user,
          password: safeStorage.decryptString(Buffer.from(entry.secret, 'base64')),
        };
      } catch {
        return null;
      }
    },
    set(key, { user, password }, name = '') {
      if (!available()) return false;
      entries[key] = {
        user,
        secret: safeStorage.encryptString(password).toString('base64'),
        name: typeof name === 'string' ? cutText(name.replace(/[\x00-\x1f\x7f]/g, ' '), 64) : '',
        since: now(),
      };
      save();
      return true;
    },
    list: () =>
      Object.entries(entries).map(([key, { user, name, since }]) => ({ key, user, name, since })),
    forget(key) {
      if (Object.hasOwn(entries, key)) {
        delete entries[key];
        save();
      }
    },
    clear() {
      entries = {};
      save();
    },
    count: () => Object.keys(entries).length,
  };
}

module.exports = { createCredentialStore };
