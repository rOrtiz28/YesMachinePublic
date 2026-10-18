'use strict';

// Tests how this computer's networks are named and ordered (src/main/network/networks.cjs). The platform, the list
// of adapters, macOS's hardware port names and Linux's /sys entries are all stand-ins passed to the code. Only the
// last test reads the real hardware ports, and only on a Mac.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createNetworks,
  networkKind,
  readMacPorts,
} = require('../../src/main/network/networks.cjs');

test('Wi-Fi, Ethernet and virtual adapters are told apart on each platform', () => {
  // On macOS, `port` is the adapter's hardware port name, as networksetup lists it.
  const mac = (name, port) => networkKind(name, { platform: 'darwin', port });
  assert.equal(mac('en0', 'Wi-Fi'), 'wifi');
  assert.equal(mac('en7', 'USB 10/100/1000 LAN'), 'ethernet');
  assert.equal(mac('en8', 'Ethernet Adapter (en8)'), 'ethernet');
  assert.equal(mac('bridge0', 'Thunderbolt Bridge'), 'ethernet');
  for (const name of ['bridge100', 'vmnet8', 'utun3']) assert.equal(mac(name, ''), 'virtual', name);
  assert.equal(mac('en9', ''), 'other');

  // On Linux, the /sys entries of a wireless adapter (wlp2s0) and of a wired one (ens160).
  const sys = new Set([
    '/sys/class/net/wlp2s0/wireless',
    '/sys/class/net/wlp2s0/device',
    '/sys/class/net/ens160/device',
  ]);
  const linux = (name) => networkKind(name, { platform: 'linux', exists: (path) => sys.has(path) });
  assert.equal(linux('wlp2s0'), 'wifi');
  assert.equal(linux('ens160'), 'ethernet');
  assert.equal(linux('docker0'), 'virtual');
  assert.equal(linux('../../etc'), 'other');

  const windows = (name) => networkKind(name, { platform: 'win32' });
  assert.equal(windows('Wi-Fi'), 'wifi');
  assert.equal(windows('Ethernet 2'), 'ethernet');
  assert.equal(windows('vEthernet (WSL)'), 'virtual');
  assert.equal(windows('VMware Network Adapter VMnet8'), 'virtual');
  assert.equal(windows('Office'), 'other');
});

test('the list puts Ethernet and Wi-Fi before virtual adapters and names them', () => {
  const networks = createNetworks({
    platform: 'darwin',
    macPorts: () =>
      new Map([
        ['en0', 'Wi-Fi'],
        ['en7', 'USB 10/100/1000 LAN'],
      ]),
    list: () => [
      { name: 'bridge101', address: '172.16.106.1' },
      { name: 'en0', address: '192.168.1.52' },
      { name: 'en7', address: '192.168.1.60' },
    ],
  });
  assert.deepEqual(
    networks().map((n) => [n.address, n.kind, n.label]),
    [
      ['192.168.1.60', 'ethernet', 'Ethernet'],
      ['192.168.1.52', 'wifi', 'Wi-Fi'],
      ['172.16.106.1', 'virtual', 'Virtual (bridge101)'],
    ],
  );
});

test('macOS hardware ports are read again only when a new device appears', () => {
  let reads = 0,
    devices = [{ name: 'en0', address: '192.168.1.52' }];
  const networks = createNetworks({
    platform: 'darwin',
    list: () => devices,
    macPorts: () => {
      reads++;
      return new Map([['en0', 'Wi-Fi']]);
    },
  });
  networks();
  networks();
  assert.equal(reads, 1);
  devices = [...devices, { name: 'en7', address: '192.168.1.60' }];
  networks();
  networks();
  assert.equal(reads, 2);
});

test(
  'the real hardware port list parses on this Mac',
  { skip: process.platform !== 'darwin' },
  () => {
    const ports = readMacPorts();
    assert.ok(ports.size > 0);
    for (const [device, port] of ports) {
      assert.match(device, /^\S+$/);
      assert.ok(port.length > 0);
    }
  },
);
