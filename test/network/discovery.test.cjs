'use strict';

// Tests local network discovery (src/main/network/discovery.cjs): checking the mDNS records that other computers and
// Android devices announce, the bounded lists of what was found, this computer's own announcement, and how failures
// are reported. Nothing goes on the network: bonjour-service is replaced by a stand-in whose browsers the tests make
// announce records, and the clock and timers are fake ones that the tests move forward by hand.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createDiscovery,
  normalizeService,
  normalizeAndroid,
  privateIPv4,
  MAX_DEVICES,
  REFRESH_MS,
  MAX_AGE_MS,
} = require('../../src/main/network/discovery.cjs');

// A SHA-256 fingerprint in lowercase, as a TXT record may carry it.
const fingerprint = Array(32).fill('ab').join(':');

/**
 * A computer sharing its screen, as bonjour-service reports its _yes-machine._tcp record, with `overrides` replacing
 * any of its fields.
 */
function service(overrides = {}) {
  return {
    name: 'Office-123',
    fqdn: 'Office-123._yes-machine._tcp.local',
    host: 'office.local',
    type: 'yes-machine',
    protocol: 'tcp',
    port: 4777,
    ttl: 120,
    addresses: ['192.168.1.20'],
    referer: { address: '192.168.1.20', port: 5353 },
    txt: { v: '1', name: 'Office Mac', platform: 'darwin', ip: '192.168.1.20', fp: fingerprint },
    ...overrides,
  };
}

// An Android device sharing in general mode, as the Yes Machine app announces it through Android's NsdManager.
function android(overrides = {}) {
  return {
    name: "Alejandro's Tab",
    fqdn: "Alejandro's Tab._yes-machine-device._tcp.local",
    host: 'Android_ABC.local',
    type: 'yes-machine-device',
    protocol: 'tcp',
    port: 4778,
    ttl: 120,
    addresses: ['192.168.1.40', 'fe80::1'],
    referer: { address: '192.168.1.40', port: 5353 },
    txt: {
      v: '1',
      name: "Alejandro's Tab",
      system: 'Android 16',
      platform: 'android',
      kind: 'tablet',
      fingerprint,
    },
    ...overrides,
  };
}

/**
 * Discovery with stand-ins for everything around it, and controls for the test:
 * - Bonjour is FakeBonjour, which records its browsers and announcements. The fail* options make its constructor,
 *   browsing or publishing throw, with the Error given or a default one.
 * - Time stands still until advance(milliseconds), which runs every timer that falls due, in order.
 * - up(record) and down(record) make the latest computer browser report a record or its goodbye; androidUp() and
 *   androidDown() do the same for Android devices, which are browsed for only `withAndroid`.
 * It also returns the lists reported (snapshots, androidSnapshots), the errors, the Bonjour instance, and
 * jobCount(), the number of timers still set.
 */
function harness({
  failConstruction = false,
  failPublish = false,
  failBrowse = false,
  withAndroid = false,
} = {}) {
  let time = 0;
  let sequence = 0;
  const jobs = new Map();
  const snapshots = [];
  const androidSnapshots = [];
  const errors = [];
  const result = { snapshots, androidSnapshots, errors, instance: null };
  // A timer on the fake clock: due `delay` ms from now, and again every `delay` ms when it repeats.
  function schedule(callback, delay, repeat = false) {
    const id = { id: ++sequence, unref() {} };
    jobs.set(id, { callback, delay, repeat, at: time + delay });
    return id;
  }
  result.advance = (milliseconds) => {
    const target = time + milliseconds;
    for (;;) {
      const next = [...jobs]
        .filter(([, job]) => job.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next;
      time = job.at;
      if (job.repeat) job.at += job.delay;
      else jobs.delete(id);
      job.callback();
    }
    time = target;
  };
  // Stands in for bonjour-service's Bonjour. Its multicast socket's send() calls back with `sendError`, when a test
  // sets one, and remembers the last target it was given.
  class FakeBonjour {
    constructor(options, errorCallback) {
      if (failConstruction)
        throw failConstruction instanceof Error ? failConstruction : Error('permission denied');
      this.options = options;
      this.errorCallback = errorCallback;
      this.server = { mdns: new EventEmitter() };
      this.server.mdns.send = (_packet, target, callback) => {
        this.lastTarget = target;
        callback(this.sendError || null);
        return 'send-result';
      };
      this.browsers = [];
      this.advertisements = [];
      this.destroyed = false;
      result.instance = this;
    }
    find(options, callback) {
      if (failBrowse) throw failBrowse instanceof Error ? failBrowse : Error('browse failed');
      const browser = new EventEmitter();
      browser.options = options;
      browser.stop = () => {
        browser.stopped = true;
      };
      browser.on('up', callback);
      this.browsers.push(browser);
      return browser;
    }
    publish(options) {
      if (failPublish) throw failPublish instanceof Error ? failPublish : Error('publish failed');
      const advertisement = new EventEmitter();
      advertisement.options = options;
      advertisement.stop = () => {
        advertisement.stopped = true;
      };
      this.advertisements.push(advertisement);
      return advertisement;
    }
    unpublishAll(callback) {
      this.unpublished = true;
      callback();
    }
    destroy() {
      this.destroyed = true;
    }
  }
  result.discovery = createDiscovery(
    {
      onDevices: (devices) => snapshots.push(devices),
      onError: (error) => errors.push(error),
      onAndroid: withAndroid ? (devices) => androidSnapshots.push(devices) : null,
    },
    {
      Bonjour: FakeBonjour,
      // Fixed "random" bytes, so the names this computer announces are always the same.
      randomBytes: (length) => Buffer.alloc(length, 7),
      now: () => time,
      setTimeout: (fn, ms) => schedule(fn, ms),
      clearTimeout: (id) => jobs.delete(id),
      setInterval: (fn, ms) => schedule(fn, ms, true),
      clearInterval: (id) => jobs.delete(id),
    },
  );
  const latest = (type) =>
    result.instance.browsers.filter((browser) => browser.options.type === type).at(-1);
  result.up = (record) => latest('yes-machine').emit('up', record);
  result.down = (record) => latest('yes-machine').emit('down', record);
  result.androidUp = (record) => latest('yes-machine-device').emit('up', record);
  result.androidDown = (record) => latest('yes-machine-device').emit('down', record);
  result.jobCount = () => jobs.size;
  return result;
}

// --- Records from computers ---

test('normalizes complete local records without treating discovery as certificate trust', () => {
  assert.deepEqual(normalizeService(service()), {
    id: 'office-123._yes-machine._tcp.local',
    name: 'Office Mac',
    address: '192.168.1.20',
    port: 4777,
    platform: 'darwin',
    fingerprint: fingerprint.toUpperCase(),
  });
  assert.equal(normalizeService(service(), 'office.local'), null);
  assert.equal(
    normalizeService(service({ fqdn: 'Office-123._yes-machine._tcp.local.' })).id,
    'office-123._yes-machine._tcp.local',
  );
});

test('passes along a short operating system label and ignores an unsafe one', () => {
  const base = service();
  assert.equal(
    normalizeService(service({ txt: { ...base.txt, os: ' Ubuntu 24.04 ' } })).os,
    'Ubuntu 24.04',
  );
  for (const os of ['x'.repeat(49), 'Ubuntu\n24.04', '‮Ubuntu', 42]) {
    const record = normalizeService(service({ txt: { ...base.txt, os } }));
    assert.ok(record, JSON.stringify(os));
    assert.equal('os' in record, false, JSON.stringify(os));
  }
  const h = harness();
  assert.equal(
    h.discovery.startAdvertisement({
      address: '192.168.1.20',
      port: 4777,
      hostName: 'Office',
      platform: 'linux',
      fingerprint,
      system: 'Ubuntu 24.04',
    }),
    true,
  );
  assert.equal(h.instance.advertisements[0].options.txt.os, 'Ubuntu 24.04');
  h.discovery.stop();
});

test('accepts only remote private IPv4 addresses', () => {
  for (const ip of ['10.2.3.4', '172.16.1.2', '172.31.2.3', '192.168.0.2', '169.254.2.3'])
    assert.equal(privateIPv4(ip), true, ip);
  for (const ip of [
    '127.0.0.1',
    '::1',
    '::ffff:192.168.1.2',
    '8.8.8.8',
    '172.32.0.2',
    '224.0.0.251',
    '192.168.001.2',
    123,
    null,
  ])
    assert.equal(privateIPv4(ip), false, String(ip));
});

test('rejects malformed, unrelated, public, oversized and TXT-only endpoint claims', () => {
  const base = service();
  const invalid = [
    null,
    {},
    service({ type: 'http' }),
    service({ protocol: 'udp' }),
    service({ host: 'example.com' }),
    service({ fqdn: 'Office._http._tcp.local' }),
    service({ port: 0 }),
    service({ port: 65536 }),
    service({ port: '4777' }),
    service({ addresses: [] }),
    service({ referer: { address: '8.8.8.8' } }),
    service({ ttl: 0 }),
    service({ ttl: Infinity }),
  ];
  for (const txt of [
    null,
    { ...base.txt, v: '2' },
    { ...base.txt, ip: '8.8.8.8' },
    { ...base.txt, ip: '127.0.0.1' },
    { ...base.txt, ip: '192.168.1.99' },
    { ...base.txt, fp: 'AB:CD' },
    { ...base.txt, platform: 'android' },
    { ...base.txt, name: 'x'.repeat(97) },
    { ...base.txt, name: 'Office\nMac' },
    { ...base.txt, name: '\u202eOffice' },
  ])
    invalid.push(service({ txt }));
  for (const record of invalid)
    assert.equal(normalizeService(record), null, JSON.stringify(record));
});

// --- Browsing, announcing and the list of computers ---

test('browses immediately, advertises only on request, and advertises only its address details', () => {
  const h = harness();
  assert.deepEqual(h.instance.browsers[0].options, { type: 'yes-machine', protocol: 'tcp' });
  assert.equal(h.instance.advertisements.length, 0);
  assert.equal(
    h.discovery.startAdvertisement({
      address: '192.168.1.20',
      port: 4777,
      hostName: 'Office.Mac',
      platform: 'darwin',
      fingerprint,
    }),
    true,
  );
  const published = h.instance.advertisements[0];
  assert.equal(published.options.type, 'yes-machine');
  assert.equal(published.options.protocol, 'tcp');
  assert.match(published.options.host, /^yes-machine-[a-f0-9]{24}\.local$/);
  assert.match(published.options.name, /^Office-Mac-[a-f0-9]{12}$/);
  assert.deepEqual(Object.keys(published.options.txt).sort(), [
    'fp',
    'ip',
    'name',
    'platform',
    'v',
  ]);
  assert.equal(published.options.txt.fp, fingerprint.toUpperCase());
  h.up(service({ host: published.options.host }));
  assert.equal(h.discovery.getDevices().length, 0);
  h.discovery.stopAdvertisement();
  assert.equal(published.stopped, true);
  assert.equal(h.instance.browsers[0].stopped, undefined);
  h.discovery.stop();
});

test('bounded snapshots deduplicate endpoints, replace details, and resist external mutation', () => {
  const h = harness();
  for (let index = 0; index < MAX_DEVICES + 20; index++) {
    h.up(service({ fqdn: `Peer-${index}._yes-machine._tcp.local`, port: 10000 + index }));
  }
  assert.equal(h.discovery.getDevices().length, MAX_DEVICES);
  assert.equal(h.snapshots.length, 0);
  h.advance(100);
  assert.equal(h.snapshots.length, 1);
  const duplicate = service({
    fqdn: 'New-name._yes-machine._tcp.local',
    port: 10000,
    txt: { ...service().txt, name: 'Renamed computer' },
  });
  h.up(duplicate);
  assert.equal(h.discovery.getDevices().length, MAX_DEVICES);
  assert.equal(
    h.discovery.getDevices().find((item) => item.port === 10000).name,
    'Renamed computer',
  );
  const copy = h.discovery.getDevices();
  copy[0].name = 'mutated';
  assert.notEqual(h.discovery.getDevices()[0].name, 'mutated');
  h.down(service({ fqdn: 'Peer-0._yes-machine._tcp.local', port: 10000 }));
  assert.equal(
    h.discovery.getDevices().length,
    MAX_DEVICES,
    'old alias goodbye must not remove replacement',
  );
  h.down(duplicate);
  assert.equal(h.discovery.getDevices().length, MAX_DEVICES - 1);
  h.discovery.stop();
});

test('SRV updates move a service rather than duplicating it', () => {
  const h = harness();
  h.up(service());
  h.instance.browsers[0].emit('srv-update', service({ port: 4888 }));
  assert.equal(h.discovery.getDevices().length, 1);
  assert.equal(h.discovery.getDevices()[0].port, 4888);
  h.discovery.stop();
});

test('goodbye removes immediately and abandoned services expire even with huge TTL', () => {
  const h = harness();
  h.up(service());
  h.down(service());
  assert.deepEqual(h.discovery.getDevices(), []);
  h.up(service({ ttl: 28800 }));
  h.advance(MAX_AGE_MS);
  assert.deepEqual(h.discovery.getDevices(), []);
  assert.equal(h.instance.browsers[0].stopped, true);
  assert.equal(h.instance.browsers[0].listenerCount('up'), 0);
  assert.ok(h.instance.browsers.length >= 3);
  h.discovery.stop();
});

test('fresh query responses refresh lifetime and smaller advertised TTL is honored', () => {
  const h = harness();
  h.up(service());
  h.advance(REFRESH_MS);
  h.up(service());
  h.advance(MAX_AGE_MS - REFRESH_MS);
  assert.equal(h.discovery.getDevices().length, 1);
  h.advance(REFRESH_MS);
  assert.equal(h.discovery.getDevices().length, 0);
  h.up(service({ ttl: 2 }));
  h.advance(5000);
  assert.equal(h.discovery.getDevices().length, 0);
  h.discovery.stop();
});

// --- Failures, stopping and refreshing ---

test('construction, publish and emitted multicast errors preserve manual fallback without floods', () => {
  const denied = harness({ failConstruction: true });
  assert.equal(denied.errors.length, 1);
  assert.equal(denied.errors[0].code, 'DISCOVERY_UNAVAILABLE');
  assert.deepEqual(denied.discovery.getDevices(), []);
  assert.equal(denied.discovery.startAdvertisement({}), false);
  denied.discovery.stop();
  const h = harness({ failPublish: true });
  h.instance.server.mdns.emit('error', Error('socket denied'));
  h.instance.server.mdns.emit('warning', Error('multicast failed'));
  assert.equal(
    h.discovery.startAdvertisement({
      address: '192.168.1.20',
      port: 4777,
      hostName: 'Office',
      platform: 'darwin',
      fingerprint,
    }),
    false,
  );
  assert.equal(h.errors.length, 1);
  h.advance(30000);
  h.instance.server.mdns.emit('error', Error('socket still denied'));
  assert.equal(h.errors.length, 2);
  h.discovery.stop();
});

test('stop sends goodbyes, destroys UDP, clears timers and prevents future publication', () => {
  const h = harness();
  h.up(service());
  h.discovery.stop();
  h.discovery.stop();
  assert.equal(h.instance.unpublished, true);
  assert.equal(h.instance.destroyed, true);
  assert.equal(h.jobCount(), 0);
  assert.deepEqual(h.snapshots.at(-1), []);
  assert.equal(
    h.discovery.startAdvertisement({
      address: '192.168.1.20',
      port: 4777,
      hostName: 'Office',
      platform: 'darwin',
      fingerprint,
    }),
    false,
  );
  h.advance(MAX_AGE_MS * 2);
  assert.equal(h.instance.browsers.length, 1);
});

test('UDP send callback failures reach fallback without leaking error text or changing send semantics', () => {
  const h = harness();
  const mdns = h.instance.server.mdns;
  let receivedError;
  assert.equal(
    mdns.send({}, (error) => {
      receivedError = error;
    }),
    'send-result',
  );
  assert.equal(receivedError, null);
  assert.equal(h.instance.lastTarget, null);
  assert.equal(h.errors.length, 0);
  const denied = Object.assign(Error('Arbitrary transport details must not reach the UI'), {
    code: 'EPERM',
  });
  h.instance.sendError = denied;
  const target = { address: '224.0.0.251', port: 5353 };
  mdns.send({}, target, (error) => {
    receivedError = error;
  });
  assert.equal(receivedError, denied);
  assert.equal(h.instance.lastTarget, target);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].code, 'DISCOVERY_UNAVAILABLE');
  assert.equal(h.errors[0].causeCode, 'EPERM');
  assert.equal(h.errors[0].cause, denied);
  assert.equal(h.errors[0].causeClass, 'Error');
  assert.equal(h.errors[0].stage, 'udp-send');
  assert.doesNotMatch(h.errors[0].message, /Arbitrary/);
  assert.doesNotThrow(() => mdns.send({}));
  assert.equal(h.errors.length, 1, 'repeated failures remain rate limited');
  h.advance(30000);
  h.instance.sendError = Object.assign(Error('invalid code'), { code: 'secret\nvalue' });
  mdns.send({});
  assert.equal(h.errors.length, 2);
  assert.equal(h.errors[1].causeCode, undefined);
  h.discovery.stop();
});

test('retains caught initialization, browse, and publication causes for local diagnosis', () => {
  const cases = [
    { option: 'failConstruction', stage: 'constructor' },
    { option: 'failBrowse', stage: 'browse' },
    { option: 'failPublish', stage: 'advertise' },
  ];
  for (const { option, stage } of cases) {
    const cause = Object.assign(new TypeError('Private diagnostic detail'), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
    const h = harness({ [option]: cause });
    if (option === 'failPublish')
      h.discovery.startAdvertisement({
        address: '192.168.1.20',
        port: 4777,
        hostName: 'Office',
        platform: 'darwin',
        fingerprint,
      });
    assert.equal(h.errors.length, 1);
    const error = h.errors[0];
    assert.equal(error.cause, cause);
    assert.equal(error.causeClass, 'TypeError');
    assert.equal(error.causeCode, 'ERR_INVALID_ARG_TYPE');
    assert.equal(error.stage, stage);
    assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
    assert.doesNotMatch(JSON.stringify(error), /Private diagnostic detail/);
    assert.doesNotMatch(error.message, /Private diagnostic detail/);
    h.discovery.stop();
  }
});

test('distinguishes mDNS warnings without exposing arbitrary cause names', () => {
  const h = harness();
  const cause = Object.assign(Error('Decoder detail'), { name: 'remote\ntext' });
  h.instance.server.mdns.emit('warning', cause);
  assert.equal(h.errors[0].stage, 'mdns-warning');
  assert.equal(h.errors[0].cause, cause);
  assert.equal(h.errors[0].causeClass, undefined);
  assert.equal(h.errors[0].causeCode, undefined);
  assert.doesNotMatch(JSON.stringify(h.errors[0]), /Decoder detail|remote/);
  h.discovery.stop();
});

test('refresh asks the network again with a fresh browser', () => {
  const h = harness();
  const first = h.instance.browsers.at(-1);
  h.discovery.refresh();
  assert.equal(first.stopped, true);
  assert.equal(h.instance.browsers.length, 2);
  h.discovery.stop();
  h.discovery.refresh();
  assert.equal(h.instance.browsers.length, 2, 'a stopped discovery stays quiet');
});

// --- Android devices in general mode ---

test('normalizes an Android device sharing in general mode, without trusting its fingerprint', () => {
  assert.deepEqual(normalizeAndroid(android()), {
    id: "alejandro's tab._yes-machine-device._tcp.local",
    name: "Alejandro's Tab",
    address: '192.168.1.40',
    port: 4778,
    kind: 'tablet',
    system: 'Android 16',
    fingerprint: fingerprint.toUpperCase(),
  });
  assert.equal(
    normalizeAndroid(android({ addresses: [] })).address,
    '192.168.1.40',
    'the sender alone is enough',
  );
  const base = android();
  assert.equal(normalizeAndroid(android({ txt: { ...base.txt, kind: 'fridge' } })).kind, 'device');
  const quiet = normalizeAndroid(
    android({ txt: { ...base.txt, system: 'Android\n16', fingerprint: 'AB:CD' } }),
  );
  assert.equal('system' in quiet || 'fingerprint' in quiet, false);
});

test('rejects Android records that are malformed, public or point elsewhere', () => {
  const base = android();
  const invalid = [
    null,
    {},
    android({ type: 'yes-machine' }),
    android({ protocol: 'udp' }),
    android({ fqdn: "Alejandro's Tab._yes-machine._tcp.local" }),
    android({ port: 0 }),
    android({ port: '4778' }),
    android({ referer: { address: '8.8.8.8' } }),
    android({ referer: undefined }),
    android({ addresses: ['192.168.1.99'] }),
    android({ ttl: 0 }),
    service(),
  ];
  for (const txt of [
    null,
    { ...base.txt, v: '2' },
    { ...base.txt, platform: 'darwin' },
    { ...base.txt, name: '' },
    { ...base.txt, name: '\u202eTab' },
  ])
    invalid.push(android({ txt }));
  for (const record of invalid)
    assert.equal(normalizeAndroid(record), null, JSON.stringify(record));
});

test('browses for Android devices only when asked, and follows them as they come and go', () => {
  const quiet = harness();
  assert.deepEqual(
    quiet.instance.browsers.map((browser) => browser.options.type),
    ['yes-machine'],
  );
  quiet.discovery.stop();
  const h = harness({ withAndroid: true });
  assert.deepEqual(h.instance.browsers.map((browser) => browser.options.type).sort(), [
    'yes-machine',
    'yes-machine-device',
  ]);
  h.androidUp(android());
  h.up(service());
  h.advance(100);
  assert.equal(h.androidSnapshots.length, 1);
  assert.equal(h.androidSnapshots[0][0].name, "Alejandro's Tab");
  assert.equal(h.snapshots.at(-1).length, 1, 'computers stay in their own list');
  h.androidUp(android());
  h.advance(100);
  assert.equal(h.androidSnapshots.length, 1, 'an unchanged record says nothing new');
  h.androidUp(android({ port: 4779 }));
  h.advance(100);
  assert.equal(h.discovery.getAndroid()[0].port, 4779);
  h.androidDown(android());
  h.advance(100);
  assert.deepEqual(h.androidSnapshots.at(-1), []);
  h.androidUp(android());
  h.advance(MAX_AGE_MS + 5000);
  assert.deepEqual(h.discovery.getAndroid(), [], 'a device that stops answering expires');
  h.discovery.refresh();
  assert.equal(h.instance.browsers.filter((browser) => !browser.stopped).length, 2);
  h.discovery.stop();
  assert.equal(
    h.instance.browsers.every((browser) => browser.stopped),
    true,
  );
});
