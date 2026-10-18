'use strict';
// Finds other Yes Machine computers on the local network, and announces this one, with multicast
// DNS service discovery (mDNS/DNS-SD, as Bonjour does it) through the bonjour-service package. It
// also finds Android devices that share their screen in general mode with the Yes Machine app.
//
// main.cjs creates it once at startup with createDiscovery(). The computers found go to the host
// window's list (onDevices), the Android devices to android/general-mode.cjs and the window
// (onAndroid), and failures to the window, which then says to connect by IP address (onError).
// main.cjs announces this computer with startAdvertisement() once its sharing server listens, and
// withdraws the announcement when sharing stops.
//
// The services and their TXT records:
// - _yes-machine._tcp, a computer sharing its screen: v=1, name (its host name), platform (darwin,
//   linux or win32), ip (the private address it shares on), fp (its certificate's SHA-256
//   fingerprint) and, from newer versions, os (such as "Ubuntu 24.04").
// - _yes-machine-device._tcp, an Android device sharing in general mode: v=1, platform=android,
//   name, and optionally kind (tablet or phone), system and fingerprint.
//
// Whatever the network says is an untrusted hint. Records are checked strictly, the lists are
// bounded, and a TXT fingerprint is never a reason to trust a certificate or skip signing in:
// connecting checks the certificate itself (network/trust.cjs).
//
// A record is kept for its TTL, at most 90 seconds, and hearing it again starts that time over.
// Every 30 seconds browsing starts again with fresh browsers, which also asks the network again,
// and every 5 seconds expired records are removed.

const crypto = require('node:crypto');
const net = require('node:net');
const { isPrivateAddress } = require('./security.cjs');

// The computers' service type, and the end of their instance names.
const TYPE = 'yes-machine';
const SUFFIX = '._yes-machine._tcp.local';
// The same for Android devices sharing in general mode.
const DEVICE_TYPE = 'yes-machine-device';
const DEVICE_SUFFIX = '._yes-machine-device._tcp.local';
// The kinds an Android device can say it is; any other is shown as 'device'.
const KINDS = new Set(['tablet', 'phone']);
// At most this many computers, and this many Android devices, are kept.
const MAX_DEVICES = 64;
// How often browsing starts over, the longest a record is kept without being heard again, and
// how often expired records are removed.
const REFRESH_MS = 30000;
const MAX_AGE_MS = 90000;
const SWEEP_MS = 5000;
// A SHA-256 fingerprint: 32 hex bytes separated by colons, in either case.
const FINGERPRINT = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
// Control characters, and the Unicode controls that change the direction of text, which could
// make one name look like another.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/;

// --- Checking what the network says ---

/** Whether `value` is the private IPv4 address of another device (loopback doesn't count). */
function privateIPv4(value) {
  return (
    typeof value === 'string' &&
    net.isIP(value) === 4 &&
    isPrivateAddress(value) &&
    !value.startsWith('127.')
  );
}

/**
 * Whether `value` is a string with something besides spaces, no control or text-direction
 * characters, and at most `maxBytes` bytes in UTF-8.
 */
function shortText(value, maxBytes) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !CONTROL_CHARACTERS.test(value) &&
    Buffer.byteLength(value, 'utf8') <= maxBytes
  );
}

/**
 * A service's id: its full instance name (such as office-1a2b3c._yes-machine._tcp.local) in lower
 * case without the final dot, or null unless it is a valid name with something before `suffix`.
 */
function fqdnId(value, suffix = SUFFIX) {
  if (!shortText(value, 253)) return null;
  const id = value.replace(/\.$/, '').toLowerCase();
  if (!id.endsWith(suffix) || id.length <= suffix.length) return null;
  return id;
}

/**
 * Turns a computer's service record, as bonjour-service reports it, into { id, name, address,
 * port, platform, fingerprint, os? }, or null when anything about it is wrong. `ownHost` is this
 * computer's own announced host name, whose records are skipped.
 *
 * Discovery is an untrusted address hint. Never use its TXT fingerprint as authorization to trust
 * a certificate or skip signing in to the host.
 */
function normalizeService(service, ownHost = '') {
  if (
    !service ||
    typeof service !== 'object' ||
    service.type !== TYPE ||
    service.protocol !== 'tcp'
  )
    return null;
  const id = fqdnId(service.fqdn);
  // The service's host (from its SRV record) must be a .local name.
  if (
    !id ||
    !shortText(service.host, 253) ||
    !service.host.toLowerCase().replace(/\.$/, '').endsWith('.local')
  )
    return null;
  if (service.host.toLowerCase().replace(/\.$/, '') === ownHost.toLowerCase().replace(/\.$/, ''))
    return null;
  const txt = service.txt;
  if (!txt || typeof txt !== 'object' || Array.isArray(txt) || txt.v !== '1') return null;
  if (!shortText(txt.name, 96) || !PLATFORMS.has(txt.platform) || !privateIPv4(txt.ip)) return null;
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return null;
  if (typeof txt.fp !== 'string' || !FINGERPRINT.test(txt.fp)) return null;
  // The TXT address must also occur in the resolved A records. Do not allow a TXT-only claim to
  // redirect the UI to an arbitrary private-network service.
  if (
    !Array.isArray(service.addresses) ||
    service.addresses.length > 64 ||
    !service.addresses.includes(txt.ip)
  )
    return null;
  // The referer is where the mDNS answer came from, which must be a private address too.
  if (!service.referer || !privateIPv4(service.referer.address)) return null;
  if (service.ttl !== undefined && (!Number.isFinite(service.ttl) || service.ttl <= 0)) return null;
  // The operating system and version, such as "Ubuntu 24.04", is optional: older hosts don't send it.
  return {
    id,
    name: txt.name.trim(),
    address: txt.ip,
    port: service.port,
    platform: txt.platform,
    fingerprint: txt.fp.toUpperCase(),
    ...(shortText(txt.os, 48) ? { os: txt.os.trim() } : {}),
  };
}

/**
 * An Android device sharing its screen in general mode, as the Yes Machine app announces it:
 * { id, name, address, port, kind, system?, fingerprint? }, or null when the record is wrong.
 *
 * Like a computer's record, it is only a hint: the device's certificate is checked when
 * connecting, never trusted for its TXT fingerprint. Its address is the one the announcement came
 * from, which must be one of its A records when it lists any.
 */
function normalizeAndroid(service) {
  if (
    !service ||
    typeof service !== 'object' ||
    service.type !== DEVICE_TYPE ||
    service.protocol !== 'tcp'
  )
    return null;
  const id = fqdnId(service.fqdn, DEVICE_SUFFIX);
  const txt = service.txt;
  if (
    !id ||
    !txt ||
    typeof txt !== 'object' ||
    Array.isArray(txt) ||
    txt.v !== '1' ||
    txt.platform !== 'android' ||
    !shortText(txt.name, 96)
  )
    return null;
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return null;
  const address = service.referer?.address;
  if (!privateIPv4(address)) return null;
  if (
    service.addresses !== undefined &&
    (!Array.isArray(service.addresses) ||
      service.addresses.length > 64 ||
      (service.addresses.length && !service.addresses.includes(address)))
  )
    return null;
  if (service.ttl !== undefined && (!Number.isFinite(service.ttl) || service.ttl <= 0)) return null;
  return {
    id,
    name: txt.name.trim(),
    address,
    port: service.port,
    kind: KINDS.has(txt.kind) ? txt.kind : 'device',
    ...(shortText(txt.system, 48) ? { system: txt.system.trim() } : {}),
    ...(typeof txt.fingerprint === 'string' && FINGERPRINT.test(txt.fingerprint)
      ? { fingerprint: txt.fingerprint.toUpperCase() }
      : {}),
  };
}

/** `value` cut to at most `maximum` bytes of UTF-8, without splitting a character. */
function truncateUtf8(value, maximum) {
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maximum) break;
    result += character;
  }
  return result;
}

// --- Discovery ---

/**
 * Starts local mDNS browsing immediately and returns its controls, all of them synchronous:
 * - startAdvertisement(details): announces this computer as sharing. Advertising starts only after
 *   the caller has started its sharing server. Returns whether the announcement started.
 * - stopAdvertisement(): withdraws the announcement.
 * - getDevices(), getAndroid(): the computers and Android devices found so far.
 * - refresh(): asks the network again right away.
 * - stop(): ends discovery for good.
 *
 * onDevices hears the sorted list of computers whenever it changes, at most every 100 ms. With
 * onAndroid, it also browses for Android devices sharing in general mode, reported the same way.
 * onError hears a display-safe error at most every 30 seconds (see reportError()).
 *
 * Optional dependencies keep tests offline: Bonjour, the clock, the timers and the random bytes
 * can be replaced. Production uses bonjour-service.
 */
function createDiscovery(
  { onDevices = () => {}, onError = () => {}, onAndroid = null } = {},
  dependencies = {},
) {
  const Bonjour = dependencies.Bonjour || require('bonjour-service').Bonjour;
  const now = dependencies.now || Date.now;
  const interval = dependencies.setInterval || setInterval;
  const clearEvery = dependencies.clearInterval || clearInterval;
  const later = dependencies.setTimeout || setTimeout;
  const cancelLater = dependencies.clearTimeout || clearTimeout;
  const random = dependencies.randomBytes || crypto.randomBytes;
  // A random id for this run. ownHost is the host name this computer announces, so its own records
  // can be recognized and skipped when they come back.
  const sessionId = random(12).toString('hex');
  const ownHost = `yes-machine-${sessionId}.local`;
  // Computers by "address:port", each as { device, expiresAt }.
  const records = new Map();
  const androids = new Map(); // id -> { device, expiresAt }
  let bonjour = null;
  let browser = null;
  let androidBrowser = null;
  let androidTimer = null;
  let advertisement = null;
  let stopped = false;
  let refreshTimer = null;
  let sweepTimer = null;
  let notifyTimer = null;
  let lastReportedError = -Infinity;

  // --- The lists ---

  // Copies, so callers can't change the records, sorted by name, then address and port.
  const getDevices = () =>
    Array.from(records.values(), ({ device }) => ({ ...device })).sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.address.localeCompare(b.address) || a.port - b.port,
    );

  /** Tells onDevices the list, once for all the changes within 100 ms. */
  function notify() {
    if (stopped || notifyTimer !== null) return;
    notifyTimer = later(() => {
      notifyTimer = null;
      if (!stopped) onDevices(getDevices());
    }, 100);
    notifyTimer?.unref?.();
  }

  const getAndroid = () =>
    Array.from(androids.values(), ({ device }) => ({ ...device })).sort(
      (a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address),
    );

  /** Tells onAndroid the list of Android devices, once for all the changes within 100 ms. */
  function notifyAndroid() {
    if (stopped || androidTimer !== null) return;
    androidTimer = later(() => {
      androidTimer = null;
      if (!stopped) onAndroid(getAndroid());
    }, 100);
    androidTimer?.unref?.();
  }

  // --- Errors ---

  /**
   * Reports that discovery isn't working, at most once every 30 seconds. onError gets an Error
   * that is safe to show: a fixed message, code 'DISCOVERY_UNAVAILABLE', the `stage` where it
   * failed, and the cause's class name and OS error code when they look like standard ones.
   */
  function reportError(cause, stage = 'unknown') {
    if (stopped || now() - lastReportedError < 30000) return;
    lastReportedError = now();
    const error = new Error(
      'Automatic discovery is unavailable on this network. You can still connect by IP address.',
      { cause },
    );
    error.code = 'DISCOVERY_UNAVAILABLE';
    error.stage = stage;
    // Keep the original cause non-enumerable for local diagnosis, while only exposing known error
    // class names and OS codes as display-safe metadata.
    if (
      typeof cause?.name === 'string' &&
      /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError)$/.test(
        cause.name,
      )
    ) {
      error.causeClass = cause.name;
    }
    // Expose only a bounded OS error code, never arbitrary packet/error text.
    if (typeof cause?.code === 'string' && /^[A-Z][A-Z0-9_]{0,47}$/.test(cause.code))
      error.causeCode = cause.code;
    onError(error);
  }

  // --- What the browsers hear ---

  /** A computer's record arrived or changed (the up, txt-update and srv-update events). */
  function up(service) {
    if (stopped) return;
    const device = normalizeService(service, ownHost);
    if (!device) return;
    const key = `${device.address}:${device.port}`;
    // A changed SRV/TXT record replaces this service's former endpoint.
    for (const [oldKey, record] of records) {
      if (record.device.id === device.id && oldKey !== key) records.delete(oldKey);
    }
    // A full list still updates the endpoints it has, but takes no new ones.
    if (!records.has(key) && records.size >= MAX_DEVICES) return;
    const old = records.get(key);
    // The TTL is in seconds; without one, or above 90 seconds, a record is kept 90 seconds.
    const ttl = Math.min(MAX_AGE_MS, (service.ttl || MAX_AGE_MS / 1000) * 1000);
    records.set(key, { device, expiresAt: now() + ttl });
    // Only a real change is reported.
    if (!old || JSON.stringify(old.device) !== JSON.stringify(device)) notify();
  }

  /** A computer said goodbye: every endpoint of that service goes at once. */
  function down(service) {
    if (stopped) return;
    const id = fqdnId(service?.fqdn);
    if (!id) return;
    let changed = false;
    for (const [key, record] of records) {
      if (record.device.id === id) {
        records.delete(key);
        changed = true;
      }
    }
    if (changed) notify();
  }

  /** An Android device's record arrived or changed. Devices are kept by id, so a move replaces. */
  function androidUp(service) {
    if (stopped) return;
    const device = normalizeAndroid(service);
    if (!device || (!androids.has(device.id) && androids.size >= MAX_DEVICES)) return;
    const old = androids.get(device.id);
    const ttl = Math.min(MAX_AGE_MS, (service.ttl || MAX_AGE_MS / 1000) * 1000);
    androids.set(device.id, { device, expiresAt: now() + ttl });
    if (!old || JSON.stringify(old.device) !== JSON.stringify(device)) notifyAndroid();
  }

  /** An Android device said goodbye. */
  function androidDown(service) {
    const id = fqdnId(service?.fqdn, DEVICE_SUFFIX);
    if (!stopped && id && androids.delete(id)) notifyAndroid();
  }

  // --- Browsing ---

  /** Stops and drops the browsers. */
  function closeBrowser() {
    for (const previous of [browser, androidBrowser]) {
      if (!previous) continue;
      try {
        previous.stop();
      } catch (cause) {
        reportError(cause, 'browse-stop');
      }
      previous.removeAllListeners();
    }
    browser = null;
    androidBrowser = null;
  }

  /** Replaces the browsers with fresh ones, which query the network as they start. */
  function browse() {
    if (stopped || !bonjour) return;
    closeBrowser();
    try {
      browser = bonjour.find({ type: TYPE, protocol: 'tcp' }, up);
      browser.on('down', down);
      browser.on('txt-update', up);
      browser.on('srv-update', up);
      browser.on('error', (cause) => reportError(cause, 'browse-error'));
      if (onAndroid) {
        androidBrowser = bonjour.find({ type: DEVICE_TYPE, protocol: 'tcp' }, androidUp);
        androidBrowser.on('down', androidDown);
        androidBrowser.on('txt-update', androidUp);
        androidBrowser.on('srv-update', androidUp);
        androidBrowser.on('error', (cause) => reportError(cause, 'browse-error'));
      }
    } catch (cause) {
      reportError(cause, 'browse');
    }
  }

  /** Removes the records that weren't heard again in time, and reports the lists that changed. */
  function expire() {
    if (stopped) return;
    let changed = false;
    for (const [key, record] of records) {
      if (record.expiresAt <= now()) {
        records.delete(key);
        changed = true;
      }
    }
    if (changed) notify();
    let gone = false;
    for (const [id, record] of androids) {
      if (record.expiresAt <= now()) {
        androids.delete(id);
        gone = true;
      }
    }
    if (gone) notifyAndroid();
  }

  // --- Announcing this computer ---

  /** Withdraws this computer's announcement, if there is one. */
  function stopAdvertisement() {
    const previous = advertisement;
    advertisement = null;
    if (!previous) return;
    try {
      previous.stop();
    } catch (cause) {
      reportError(cause, 'advertise-stop');
    }
  }

  /**
   * Announces this computer as sharing, replacing any earlier announcement: its private IPv4
   * `address` and `port`, `hostName`, `platform`, certificate `fingerprint` and, when given,
   * `system` (such as "macOS 15.6"). Returns false, without announcing, when a detail isn't valid
   * or discovery isn't running.
   */
  function startAdvertisement({ address, port, hostName, platform, fingerprint, system } = {}) {
    if (stopped || !bonjour) return false;
    if (
      !privateIPv4(address) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !shortText(hostName, 96) ||
      !PLATFORMS.has(platform) ||
      typeof fingerprint !== 'string' ||
      !FINGERPRINT.test(fingerprint)
    ) {
      reportError(undefined, 'advertise-validation');
      return false;
    }
    stopAdvertisement();
    // The instance name: the host name, without dots and at most 36 bytes, then part of this
    // run's id, so that two computers with the same name still have different instance names.
    const name = `${truncateUtf8(hostName.trim().replace(/\./g, '-'), 36)}-${sessionId.slice(0, 12)}`;
    try {
      advertisement = bonjour.publish({
        name,
        host: ownHost,
        type: TYPE,
        protocol: 'tcp',
        port,
        disableIPv6: true,
        txt: {
          v: '1',
          name: hostName.trim(),
          platform,
          ip: address,
          fp: fingerprint.toUpperCase(),
          ...(shortText(system, 48) ? { os: system.trim() } : {}),
        },
      });
      advertisement.on('error', (cause) => reportError(cause, 'advertise-error'));
      return true;
    } catch (cause) {
      reportError(cause, 'advertise');
      return false;
    }
  }

  // --- Stopping ---

  /**
   * Stops discovery for good: the timers, the browsers and the lists. onDevices hears an empty
   * list, and so does onAndroid if it had devices. This computer's announcement says goodbye
   * before the mDNS socket closes.
   */
  function stop() {
    if (stopped) return;
    stopped = true;
    clearEvery(refreshTimer);
    clearEvery(sweepTimer);
    cancelLater(notifyTimer);
    cancelLater(androidTimer);
    notifyTimer = null;
    androidTimer = null;
    closeBrowser();
    records.clear();
    onDevices([]);
    if (onAndroid && androids.size) {
      androids.clear();
      onAndroid([]);
    }
    const instance = bonjour;
    bonjour = null;
    advertisement = null;
    if (!instance) return;
    let destroyed = false;
    let fallback = null;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      cancelLater(fallback);
      try {
        instance.destroy();
      } catch {
        /* Ignored: connecting by IP address doesn't depend on discovery. */
      }
    };
    // Give goodbye packets a bounded opportunity to leave before closing UDP: unpublishAll()
    // destroys the instance once they are sent, or the fallback does after 500 ms.
    fallback = later(destroy, 500);
    fallback?.unref?.();
    try {
      instance.unpublishAll(destroy);
    } catch {
      destroy();
    }
  }

  // --- Start ---

  try {
    // IPv4 only. reuseAddr shares the mDNS port with the system's own mDNS responder.
    bonjour = new Bonjour({ type: 'udp4', reuseAddr: true }, (cause) =>
      reportError(cause, 'query-response'),
    );
    // bonjour-service 1.4.4's constructor callback covers query-response errors, but not
    // multicast-dns's emitted socket errors. This pinned-version bridge handles those too, so
    // denied multicast permission cannot crash the app.
    const mdns = bonjour.server?.mdns;
    mdns?.on('error', (cause) => reportError(cause, 'socket-error'));
    mdns?.on('warning', (cause) => reportError(cause, 'mdns-warning'));
    if (typeof mdns?.send === 'function') {
      const originalSend = mdns.send;
      // Upstream probe/announce callbacks ignore UDP send errors. Surface those failures while
      // preserving both send overloads, send(packet, callback) and send(packet, target, callback),
      // and the caller's callback.
      mdns.send = function (packet, target, callback) {
        if (typeof target === 'function') {
          callback = target;
          target = null;
        }
        return originalSend.call(mdns, packet, target, (error) => {
          if (error) reportError(error, 'udp-send');
          if (typeof callback === 'function') callback(error);
        });
      };
    }
    browse();
    // Fresh browsers work around upstream 1.4.4 retaining lastSeen on unchanged answers. They also
    // bound its internal service cache to a single scan.
    refreshTimer = interval(browse, REFRESH_MS);
    sweepTimer = interval(expire, SWEEP_MS);
    refreshTimer?.unref?.();
    sweepTimer?.unref?.();
  } catch (cause) {
    reportError(cause, 'constructor');
  }

  /** Asks the network again right away, for the refresh button. */
  function refresh() {
    if (!stopped) browse();
  }

  return { startAdvertisement, stopAdvertisement, stop, getDevices, getAndroid, refresh };
}

module.exports = {
  createDiscovery,
  normalizeService,
  normalizeAndroid,
  privateIPv4,
  MAX_DEVICES,
  REFRESH_MS,
  MAX_AGE_MS,
};
