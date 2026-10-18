'use strict';
// The checks that keep Yes Machine on the local network:
// - isPrivateAddress(): whether an address belongs to a private network or to this computer.
// - localAddresses(): this computer's own private IPv4 addresses, by network adapter.
// - safeFilename(): a received file's name, made safe to save on any operating system.
// - candidateAllowed() and validSignal(): WebRTC signaling filters that allow only direct
//   connections between private addresses, never public addresses or relays.
//
// sharing/server.cjs applies them to every request and signaling message. discovery.cjs,
// networks.cjs, probe.cjs and trust.cjs in this folder use the address checks, and main.cjs checks
// the network chosen for sharing against localAddresses().
const net = require('node:net');
const os = require('node:os');

// --- Addresses ---

/**
 * Whether `value` is a private or loopback address: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * link-local 169.254.0.0/16, 127.0.0.0/8 or ::1. An IPv4 address written as IPv6
 * (::ffff:192.168.1.5, as Node reports IPv4 clients of an IPv6 socket) counts as that IPv4
 * address. Every other IPv6 address, and anything that isn't an address, is refused.
 */
function isPrivateAddress(value) {
  const ip = String(value || '').replace(/^::ffff:/, '');
  if (ip === '::1') return true;
  if (net.isIP(ip) !== 4) return false;
  const octets = ip.split('.').map(Number);
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

/**
 * This computer's private IPv4 addresses, as [{ name, address }] where name is the network
 * adapter's (en0, eth0, "Wi-Fi"...). Loopback and public addresses are left out.
 */
function localAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries || [])
      .filter(
        (entry) => entry.family === 'IPv4' && !entry.internal && isPrivateAddress(entry.address),
      )
      .map((entry) => ({ name, address: entry.address })),
  );
}

// --- Received file names ---

/**
 * Makes the name of a file from another device safe to save here. Characters Windows forbids
 * (<>:"/\|?*), control characters and DEL become _, leading dots (a hidden name, or "..") become
 * one _, the name is cut to 180 characters and loses trailing dots and spaces (which Windows
 * drops), and Windows device names get a leading _. Anything that isn't a name, or ends up empty,
 * becomes "received-file".
 */
function safeFilename(value) {
  if (typeof value !== 'string') return 'received-file';
  let name = value
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 180)
    .replace(/[. ]+$/, '');
  // Windows treats device basenames as special even when followed by an extension (CON.txt is
  // still the console), and it counts the superscript digits ¹, ² and ³ in COM and LPT names.
  if (
    /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(name)
  )
    name = '_' + name;
  return name || 'received-file';
}

// --- WebRTC signaling ---

/**
 * Whether an ICE candidate may be used: a direct host candidate whose address is private, or an
 * mDNS name (browsers hide their local address behind a random name ending in .local).
 * `candidate` is the candidate line, or an object holding it in `candidate`, as RTCIceCandidate
 * does. An empty one, which marks the end of the candidates, is allowed.
 */
function candidateAllowed(candidate) {
  if (!candidate) return true;
  const text = typeof candidate === 'string' ? candidate : candidate.candidate;
  if (text === '') return true;
  if (typeof text !== 'string' || text.length > 2048) return false;
  // candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...
  // The component is 1 (RTP) or 2 (RTCP), and the priority a 32-bit number.
  const fields = text.replace(/^a=/, '').trim().split(/\s+/);
  const integer = (value, min, max) =>
    /^\d+$/.test(value || '') && Number(value) >= min && Number(value) <= max;
  if (
    !/^candidate:[a-z0-9+/]{1,32}$/i.test(fields[0]) ||
    !integer(fields[1], 1, 2) ||
    !/^(?:udp|tcp)$/i.test(fields[2] || '') ||
    !integer(fields[3], 0, 4294967295) ||
    !integer(fields[5], 1, 65535)
  )
    return false;
  // Only direct host candidates. No public addresses, relays or peer reflexive candidates.
  return (
    fields[6] === 'typ' &&
    fields[7] === 'host' &&
    (isPrivateAddress(fields[4]) || /^[a-z0-9-]+\.local$/i.test(fields[4]))
  );
}

/**
 * Whether a WebRTC signaling message may pass between the host and the viewer: an ICE candidate
 * that candidateAllowed() accepts, or an offer or answer whose SDP is at most 100,000 characters
 * and has only allowed candidates in its a=candidate lines. sharing/server.cjs checks both
 * directions with it.
 */
function validSignal(message) {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'ice') return candidateAllowed(message.candidate);
  if (
    !['offer', 'answer'].includes(message.type) ||
    message.sdp?.type !== message.type ||
    typeof message.sdp.sdp !== 'string' ||
    message.sdp.sdp.length > 100000
  )
    return false;
  return message.sdp.sdp
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('a=candidate:'))
    .every(candidateAllowed);
}

module.exports = { isPrivateAddress, localAddresses, safeFilename, candidateAllowed, validSignal };
