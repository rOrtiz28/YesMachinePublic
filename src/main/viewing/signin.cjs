'use strict';
// Signs in to a sharing computer with its account and returns the one-time ticket for a viewer
// window. viewing/viewer.cjs calls it; the other end is POST /login in sharing/server.cjs, and the
// ticket then opens one session on the computer's session socket.
const https = require('node:https');

/**
 * Posts the user name and password to the computer's /login and resolves with its ticket, 64 hex
 * characters. `target` is the computer's { address, port }, and `fingerprint` the SHA-256
 * fingerprint the person approved for it (network/trust.cjs).
 *
 * Posts the sign-in only after the TLS handshake shows the approved certificate, so the password
 * never reaches anyone else on the network. The certificate chain isn't verified, because sharing
 * computers use self-signed certificates; the fingerprint check replaces it.
 *
 * A refusal from the computer rejects with its message and the HTTP `status` (401 for a wrong user
 * name or password). Not reaching it, no answer within 20 seconds, a different certificate or an
 * unexpected answer reject too.
 */
function requestTicket(target, fingerprint, user, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ user, password });
    const request = https.request(
      {
        host: target.address,
        port: target.port,
        path: '/login',
        method: 'POST',
        // Always a new connection, never a pooled one, so the handshake check below always runs.
        agent: false,
        rejectUnauthorized: false,
        timeout: 20000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
          // The answer is a short JSON object, so a longer one is refused.
          if (text.length > 4096) request.destroy(Error('The computer sent an unexpected answer.'));
        });
        response.on('end', () => {
          let data = {};
          try {
            data = JSON.parse(text);
          } catch {}
          if (response.statusCode === 200 && /^[0-9a-f]{64}$/.test(data.ticket))
            resolve(data.ticket);
          else
            reject(
              Object.assign(Error(data.error || 'Sign-in failed. Try again.'), {
                status: response.statusCode,
              }),
            );
        });
      },
    );
    // Nothing is sent until request.end(), not even the headers, and that waits for the handshake
    // to show the approved certificate.
    request.on('socket', (socket) =>
      socket.once('secureConnect', () => {
        if (socket.getPeerCertificate().fingerprint256 !== fingerprint)
          request.destroy(
            Error('This computer’s certificate changed. Connect again to verify it.'),
          );
        else request.end(body);
      }),
    );
    request.on('timeout', () =>
      request.destroy(
        Error('The computer did not answer. Check that Yes Machine is sharing on it.'),
      ),
    );
    request.on('error', reject);
  });
}

module.exports = { requestTicket };
