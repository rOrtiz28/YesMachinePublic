'use strict';
// Certificates the user approved, one per private address and port. A host that shows a different
// certificate needs approval again, as in the Android viewer.
//
// main.cjs keeps one store, trusted-hosts.json in the app's data folder, for both kinds of
// connection made from here: computers opened in viewer windows (viewing/viewer.cjs) and Android
// devices sharing in general mode (android/general-mode.cjs). Both approve only a fingerprint they
// just saw in their own TLS handshake, never one from discovery or from a page.
const crypto = require('node:crypto');
const net = require('node:net');
const { isPrivateAddress } = require('./security.cjs');
const { readJson, writePrivateJson } = require('../system/private-json.cjs');

// A SHA-256 fingerprint as Node writes it: 32 uppercase hex bytes separated by colons.
const FINGERPRINT = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;

/**
 * Checks a { address, port } that came from a page or a file. Returns { address, port, key }, where
 * key is "address:port", or null unless the address is private IPv4 and the port is valid.
 */
function validTarget(value) {
  const address = String(value?.address ?? ''),
    port = Number(value?.port);
  if (
    net.isIP(address) !== 4 ||
    !isPrivateAddress(address) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return null;
  return { address, port, key: `${address}:${port}` };
}

/** The target an "address:port" key stands for, or null when the key isn't a valid one. */
function fromKey(key) {
  const match = /^([\d.]+):(\d{1,5})$/.exec(String(key));
  return match ? validTarget({ address: match[1], port: Number(match[2]) }) : null;
}

/** The SHA-256 fingerprint of a PEM certificate, or '' when it can't be read. */
function fingerprintOf(pem) {
  try {
    return new crypto.X509Certificate(pem).fingerprint256;
  } catch {
    return '';
  }
}

/**
 * Opens the store saved in `file`; entries that aren't a valid key and fingerprint are dropped as
 * it loads. Every change saves the whole store privately (system/private-json.cjs). Returns:
 * - get(key): the fingerprint approved for "address:port", or null.
 * - set(key, fingerprint): approves it; throws when the key or the fingerprint isn't valid.
 * - clear(): forgets every approval.
 * - count(): how many there are.
 * - allows(hostname, fingerprint): whether a viewer window may accept that certificate.
 */
function createTrustStore(file) {
  let pins = {};
  for (const [key, value] of Object.entries(readJson(file, {}) || {}))
    if (fromKey(key) && FINGERPRINT.test(value)) pins[key] = value;
  const save = () => writePrivateJson(file, pins);
  return {
    get: (key) => pins[key] || null,
    set(key, fingerprint) {
      if (!fromKey(key) || !FINGERPRINT.test(fingerprint))
        throw Error('That certificate cannot be trusted.');
      pins[key] = fingerprint;
      save();
    },
    clear() {
      pins = {};
      save();
    },
    count: () => Object.keys(pins).length,
    // The browser engine reports only the host name, so any approved port on that address
    // qualifies. The colon keeps 192.168.1.6 from matching 192.168.1.60's approvals.
    allows: (hostname, fingerprint) =>
      !!fingerprint &&
      Object.entries(pins).some(
        ([key, value]) => key.startsWith(`${hostname}:`) && value === fingerprint,
      ),
  };
}

module.exports = { createTrustStore, fingerprintOf, validTarget, FINGERPRINT };
