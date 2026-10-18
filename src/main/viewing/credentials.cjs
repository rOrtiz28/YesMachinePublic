'use strict';
// Remembered sign-ins for the in-app viewer: a user name and password for each computer, by its
// "address:port" key. Passwords are encrypted with the operating system's keychain through
// Electron's safeStorage, and nothing is saved when only plain-text storage is available. User
// names are saved as they are.
//
// viewing/viewer.cjs is the only user; main.cjs gives it the file, remembered-sign-ins.json in the
// app's data folder, which is written privately (system/private-json.cjs).
const { readJson, writePrivateJson } = require('../system/private-json.cjs');

/**
 * Opens the store saved in `file`. `safeStorage` is Electron's (tests pass a stand-in). Entries
 * without a string user and secret are dropped as it loads. Returns:
 * - available(): whether passwords can be saved encrypted.
 * - get(key): { user, password }, or null when there is none, encryption isn't available, or the
 *   password can't be decrypted.
 * - set(key, { user, password }): saves it and returns true, or returns false without saving when
 *   encryption isn't available.
 * - forget(key), clear(): forget one sign-in, or all of them.
 * - count(): how many are saved.
 */
function createCredentialStore(file, safeStorage, platform = process.platform) {
  // By key: { user, secret }, where secret is the encrypted password in base64.
  let entries = {};
  for (const [key, entry] of Object.entries(readJson(file, {}) || {}))
    if (typeof entry?.user === 'string' && typeof entry?.secret === 'string')
      entries[key] = { user: entry.user, secret: entry.secret };
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
    set(key, { user, password }) {
      if (!available()) return false;
      entries[key] = { user, secret: safeStorage.encryptString(password).toString('base64') };
      save();
      return true;
    },
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
