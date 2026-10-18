'use strict';
// Checks whether computers are sharing right now, even when local discovery is blocked. The host
// window checks every computer in its list this way every few seconds (the probe IPC channel), and
// viewing/viewer.cjs uses it to read a computer's certificate before the person approves it.
//
// It only completes a TLS handshake and reads the certificate fingerprint. It never signs in or
// pairs, and the fingerprint is a status hint for the list, not a trust decision: approvals live
// in network/trust.cjs, and connecting checks the certificate again.
const net = require('node:net');
const tls = require('node:tls');
const { isPrivateAddress } = require('./security.cjs');

// The most computers one call may check.
const MAX_TARGETS = 32;

/**
 * Opens a TLS connection to address:port, then closes it. Resolves, never rejects, with
 * { address, port, online: true, fingerprint } once the handshake completes, or
 * { address, port, online: false } after an error or `timeout` ms without an answer. The
 * certificate isn't verified, since sharing computers use self-signed ones: it is only read.
 */
function probeOne(address, port, timeout) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: address, port, rejectUnauthorized: false, timeout });
    const done = (result) => {
      socket.destroy();
      resolve({ address, port, ...result });
    };
    socket.once('secureConnect', () =>
      done({ online: true, fingerprint: socket.getPeerCertificate().fingerprint256 || '' }),
    );
    socket.once('timeout', () => done({ online: false }));
    socket.once('error', () => done({ online: false }));
  });
}

/**
 * Checks a list of { address, port } at once, and resolves with one probeOne() result per target,
 * in the same order. A target that isn't a private IPv4 address with a valid port is reported
 * offline without being contacted. Rejects when `targets` isn't a list or has more than
 * MAX_TARGETS.
 */
async function probeHosts(targets, { timeout = 1500 } = {}) {
  if (!Array.isArray(targets) || targets.length > MAX_TARGETS)
    throw Error(`Check at most ${MAX_TARGETS} computers at a time.`);
  return Promise.all(
    targets.map((target) => {
      const address = String(target?.address ?? ''),
        port = Number(target?.port);
      if (
        net.isIP(address) !== 4 ||
        !isPrivateAddress(address) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      )
        return { address, port, online: false };
      return probeOne(address, port, timeout);
    }),
  );
}

module.exports = { probeHosts, MAX_TARGETS };
