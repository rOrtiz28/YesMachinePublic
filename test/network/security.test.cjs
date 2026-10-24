'use strict';

// Tests the checks that keep Yes Machine on the local network (src/main/network/security.cjs): which addresses count
// as private, cutting names, safe names for received files, and the filters on WebRTC signaling. They are plain
// functions, tested with sample addresses, names, file names, ICE candidates and session descriptions. The viewer
// page has its own copy of cutText(), which is checked against this one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isPrivateAddress,
  cutText,
  safeFilename,
  candidateAllowed,
  validSignal,
} = require('../../src/main/network/security.cjs');

// An ICE host candidate for `address`, as WebRTC writes it, with `extra` at the end.
const hostCandidate = (address = '192.168.1.20', extra = '') =>
  `candidate:1234 1 udp 2122260223 ${address} 50000 typ host${extra}`;

test('network allowlist accepts private IPv4 and loopback, rejects public and ambiguous addresses', () => {
  for (const address of [
    '127.0.0.1',
    '::1',
    '10.0.0.2',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.20.10',
    '::ffff:192.168.1.20',
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of [
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '192.169.1.1',
    '0.0.0.0',
    '255.255.255.255',
    '192.168.1.300',
    'localhost',
    '127.0.0.1.evil.test',
    'fd00::1',
    '2001:4860:4860::8888',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isPrivateAddress(address), false, String(address));
  }
});

test('filenames cannot retain path traversal, separators, controls, or dangerous Windows names', () => {
  for (const name of [
    '../../outside.txt',
    '..\\..\\outside.txt',
    '/absolute/path',
    'C:\\Windows\\file.txt',
    '<bad>:\u0000?*.txt',
    '.',
    '..',
    '',
    null,
    'a'.repeat(400),
  ]) {
    const safe = safeFilename(name);
    assert.equal(typeof safe, 'string');
    assert.ok(safe.length > 0 && safe.length <= 180);
    assert.doesNotMatch(safe, /^[. ]|[<>:"/\\|?*\x00-\x1f\x7f]/);
  }
  for (const name of ['CON', 'con.txt', 'NUL', 'aux.png', 'COM1', 'LPT9.txt']) {
    assert.doesNotMatch(safeFilename(name), /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i);
  }
  assert.equal(safeFilename('ordinary document.pdf'), 'ordinary document.pdf');
});

test('a name cut to its length never ends in half an emoji', () => {
  // 😀 is two UTF-16 units, so a cut after 180 units can land between them.
  assert.equal(cutText('a'.repeat(179) + '😀b', 180), 'a'.repeat(179));
  assert.equal(cutText('a'.repeat(178) + '😀b', 180), 'a'.repeat(178) + '😀');
  assert.equal(cutText('Alejandro’s Mac 🍎', 64), 'Alejandro’s Mac 🍎');
  assert.equal(safeFilename('a'.repeat(179) + '😀.txt'), 'a'.repeat(179));
  // The viewer page can't load this module, so it has its own copy of the same function.
  const viewer = fs.readFileSync(path.join(__dirname, '../../public/client/common.js'), 'utf8');
  assert.ok(viewer.includes(cutText.toString()), 'public/client/common.js has the same cutText()');
});

test('ICE permits direct private host and mDNS candidates only', () => {
  for (const candidate of [
    null,
    '',
    { candidate: '' },
    hostCandidate(),
    { candidate: hostCandidate('10.0.0.3') },
    hostCandidate('device-123.local'),
    'candidate:2 1 tcp 1518280447 192.168.1.3 9 typ host tcptype active',
  ]) {
    assert.equal(candidateAllowed(candidate), true, JSON.stringify(candidate));
  }
  for (const candidate of [
    hostCandidate('8.8.8.8'),
    hostCandidate('192.168.1.20').replace('typ host', 'typ srflx'),
    hostCandidate().replace('typ host', 'typ relay'),
    hostCandidate().replace('typ host', 'typ prflx'),
    hostCandidate('evil.test'),
    hostCandidate('x.local.evil.test'),
    { candidate: 1 },
    {},
    'x'.repeat(2049),
    'garbage 1 udp 2122260223 192.168.1.20 50000 typ host',
    'candidate:2 1 udp 2122260223 192.168.1.20 99999 typ host',
    'candidate:2 1 http 2122260223 192.168.1.20 50000 typ host',
  ]) {
    assert.equal(candidateAllowed(candidate), false, JSON.stringify(candidate));
  }
});

test('SDP and trickle ICE reject embedded public or relayed candidates and oversized descriptions', () => {
  const sdp = (candidates) =>
    `v=0\r\na=ice-options:trickle\r\n${candidates.map((value) => `a=${value}\r\n`).join('')}`;
  assert.equal(
    validSignal({ type: 'offer', sdp: { type: 'offer', sdp: sdp([hostCandidate()]) } }),
    true,
  );
  assert.equal(validSignal({ type: 'answer', sdp: { type: 'answer', sdp: sdp([]) } }), true);
  assert.equal(validSignal({ type: 'ice', candidate: { candidate: hostCandidate() } }), true);
  for (const value of [
    null,
    {},
    { type: 'pair' },
    { type: 'offer', sdp: { type: 'answer', sdp: sdp([]) } },
    { type: 'offer', sdp: { type: 'offer', sdp: 'x'.repeat(100001) } },
    {
      type: 'answer',
      sdp: { type: 'answer', sdp: sdp([hostCandidate(), hostCandidate('8.8.8.8')]) },
    },
    { type: 'ice', candidate: { candidate: hostCandidate().replace('typ host', 'typ relay') } },
  ]) {
    assert.equal(validSignal(value), false, JSON.stringify(value).slice(0, 100));
  }
});
