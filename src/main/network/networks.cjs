'use strict';
// Names each private network this computer is on, such as Wi-Fi or Ethernet, so the person sharing
// can tell them apart, and lists real adapters before the virtual ones that VMs, containers and
// VPNs add.
//
// main.cjs calls the function createNetworks() returns whenever the host window asks for this
// computer's info; its list is the "addresses" the window offers as networks to share on.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { localAddresses } = require('./security.cjs');

// The list's order: Ethernet first, then Wi-Fi, other adapters, and virtual ones last.
const ORDER = { ethernet: 0, wifi: 1, other: 2, virtual: 3 };

/**
 * macOS names each device in `networksetup -listallhardwareports`, such as "Wi-Fi" for en0, and
 * this reads those names. The command prints blocks that start "Hardware Port: Wi-Fi" then
 * "Device: en0". Returns a Map from device to port name, empty when the command fails or takes
 * more than 3 seconds.
 */
function readMacPorts() {
  const ports = new Map();
  try {
    const text = execFileSync('/usr/sbin/networksetup', ['-listallhardwareports'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    for (const [, port, device] of text.matchAll(/^Hardware Port: (.+)\r?\nDevice: (\S+)/gm))
      ports.set(device, port);
  } catch {}
  return ports;
}

/**
 * The kind of a network adapter: 'ethernet', 'wifi', 'virtual' or 'other'. `name` is the adapter's
 * name as Node reports it (en0, wlp2s0, "Wi-Fi"...). On macOS `port` is its hardware port name
 * from readMacPorts(). `exists` checks a path, and tests replace it.
 */
function networkKind(
  name,
  { platform = process.platform, exists = fs.existsSync, port = '' } = {},
) {
  if (platform === 'darwin') {
    if (/wi-?fi|airport/i.test(port)) return 'wifi';
    if (/ethernet|thunderbolt|\blan\b/i.test(port)) return 'ethernet';
    // The names macOS gives bridges, VMware's networks (vmnet), VPN tunnels (utun, ipsec, ppp)
    // and similar software devices.
    return /^(?:bridge|vmnet|utun|ipsec|ppp|feth|anpi)/.test(name) ? 'virtual' : 'other';
  }
  if (platform === 'linux') {
    // Only a plain interface name (at most 15 characters, as the kernel allows) is looked up.
    if (!/^[\w.-]{1,15}$/.test(name)) return 'other';
    // In /sys/class/net, a Wi-Fi interface has a wireless or phy80211 entry, and one on real
    // hardware has a device link. Bridges, tunnels and container interfaces have neither.
    if (exists(`/sys/class/net/${name}/wireless`) || exists(`/sys/class/net/${name}/phy80211`))
      return 'wifi';
    return exists(`/sys/class/net/${name}/device`) ? 'ethernet' : 'virtual';
  }
  if (platform === 'win32') {
    // Windows lists connections by their names in Network Connections, which people can rename.
    // Virtual ones are checked first, since Hyper-V's are called "vEthernet (...)".
    if (
      /vethernet|virtual|vmware|virtualbox|hyper-v|loopback|vpn|\btap\b|wsl|bluetooth/i.test(name)
    )
      return 'virtual';
    if (/wi-?fi|wireless|wlan/i.test(name)) return 'wifi';
    if (/ethernet/i.test(name)) return 'ethernet';
  }
  return 'other';
}

/** The name the host window shows: "Wi-Fi", "Ethernet", "Virtual (name)" or the adapter's name. */
function networkLabel(kind, name) {
  if (kind === 'wifi') return 'Wi-Fi';
  if (kind === 'ethernet') return 'Ethernet';
  return kind === 'virtual' ? `Virtual (${name})` : name;
}

/**
 * Creates privateNetworks(), which lists this computer's private IPv4 addresses (from
 * localAddresses()) as [{ name, address, kind, label }], sorted by ORDER. The sort keeps the
 * system's order within each kind. The options replace the system calls in tests.
 */
function createNetworks({
  platform = process.platform,
  list = localAddresses,
  exists = fs.existsSync,
  macPorts = readMacPorts,
} = {}) {
  // macOS port names by device, and the devices networksetup has been asked about.
  let ports = new Map();
  const looked = new Set();
  return function privateNetworks() {
    const found = list();
    // networksetup runs again only when a device it hasn't been asked about appears.
    if (platform === 'darwin' && found.some((network) => !looked.has(network.name))) {
      ports = macPorts();
      for (const network of found) looked.add(network.name);
    }
    return found
      .map((network) => {
        const kind = networkKind(network.name, {
          platform,
          exists,
          port: ports.get(network.name) || '',
        });
        return { ...network, kind, label: networkLabel(kind, network.name) };
      })
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  };
}

module.exports = { createNetworks, networkKind, networkLabel, readMacPorts };
