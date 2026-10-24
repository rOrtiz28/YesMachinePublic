'use strict';
// The sharing server: what other devices reach when this computer shares its screen.
//
// main.cjs starts it with createLanServer() when sharing starts, on the private IPv4 address the
// person chose, and stops it when sharing stops. It is an HTTPS server with a self-signed
// certificate for that address (see credentials()), and it answers:
// - GET / and the viewer page's files: the browser viewer, from public/.
// - POST /login: a sign-in with this computer's own account (the `authenticate` option, from
//   sharing/auth.cjs), answered with a one-time ticket. The viewer page signs in this way, and so
//   do the desktop app (viewing/signin.cjs) and the Android app, which then open the page with the
//   ticket in its URL fragment.
// - GET /download/<token>: a file the host offers the viewer, at a one-time address (sendFile()).
// - A WebSocket at /session: the session socket. Its first message spends the ticket; after that
//   it carries JSON messages, each with a `type`:
//     host to viewer: paired, replaced, offer and ice (WebRTC signaling, from signal()),
//       file-ready, file-done, download-offer, download-progress, download-end, download-error,
//       and error;
//     viewer to host: answer and ice (WebRTC signaling, to onSignal), file-start, file-chunk
//       and file-end (a file from the viewer, to onUpload), and download-decline (an offered file
//       the viewer can't take now, which paired's `declines: true` says this host understands).
//
// The screen, sound, input and clipboard don't pass through this server: they travel over the
// WebRTC connection, which the host window (src/windows/host/) sets up with the signaling relayed
// here. One viewer holds the session at a time, and a newer sign-in takes over. Only
// private-network addresses are served (network/security.cjs), and sign-ins, connections, messages
// and files all have limits.
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { WebSocketServer, WebSocket } = require('ws');
const selfsigned = require('selfsigned');
const { isPrivateAddress, safeFilename, validSignal } = require('../network/security.cjs');

// --- Limits and fixed settings ---

const LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB a file
const ROOM = 256 * 1024 * 1024; // what an arriving file must leave free on this computer's disk
const OFFER_MS = 10 * 60 * 1000; // how long a viewer has to start taking a file the host offers
// How long a sign-in ticket can wait to be spent on the session socket.
const TICKET_MS = 60 * 1000;
// The failed sign-ins allowed in a minute: from each address, and from every address together.
const FAILURES_PER_ADDRESS = 20,
  FAILURES_IN_ALL = 100;
// The fonts the viewer page uses, served from public/fonts/ like the rest of the page.
const VIEWER_FONTS = [
  'pixelify-sans-latin-700-normal.woff2',
  'jetbrains-mono-latin-400-normal.woff2',
  'jetbrains-mono-latin-500-normal.woff2',
  'jetbrains-mono-latin-700-normal.woff2',
];
// The viewer page's own scripts, served from public/client/, in the order client.html loads them.
const CLIENT_SCRIPTS = [
  'common.js',
  'cats.js',
  'session.js',
  'stream.js',
  'sign-in.js',
  'screens.js',
  'pointer.js',
  'keyboard.js',
  'clipboard.js',
  'files.js',
  'layout.js',
  'start.js',
];
// The viewer page's Content Security Policy: everything from this server ('self'), plus secure
// WebSockets (wss:), blob: media and data: images; no plugins, no <base>, no framing by other
// pages, and forms only to this server.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' wss:; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/** The space left for files on the disk that holds `directory`, in bytes. */
function freeBytes(directory) {
  const disk = fs.statfsSync(directory);
  return disk.bavail * disk.bsize;
}

// --- The TLS identity ---

/**
 * The TLS key and self-signed certificate this computer shares with on `address`, kept in
 * identity.json in `directory`, readable only by this user. Resolves { address, key, cert,
 * fingerprint }; the fingerprint (SHA-256) is what other devices approve.
 *
 * One identity per address, so a computer that moves between Wi-Fi and Ethernet keeps the
 * certificate other devices approved for each of its addresses. The four most recently used
 * addresses are kept. A certificate lasts a year, and a new one is made when it would expire
 * within a day.
 */
async function credentials(directory, address) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'identity.json');
  // The file holds { identities: { [address]: { key, cert } } }, the most recent address first.
  // Earlier versions kept a single { address, key, cert }, which is read the same way.
  let saved = {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved =
      data.identities ||
      (data.address ? { [data.address]: { key: data.key, cert: data.cert } } : {});
  } catch {}
  let identity = Object.hasOwn(saved, address) ? saved[address] : null;
  // A saved certificate that doesn't parse, or expires within a day (86,400,000 ms), is replaced.
  // Without a saved identity, reading identity.cert throws, which also means a new one.
  try {
    if (Date.parse(new crypto.X509Certificate(identity.cert).validTo) < Date.now() + 86400000)
      identity = null;
  } catch {
    identity = null;
  }
  const fresh = !identity;
  if (fresh) {
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'Yes Machine' }], {
      keySize: 2048,
      algorithm: 'sha256',
      days: 365,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        // Devices connect by IP address, so the certificate names the address (type 7 is an IP).
        { name: 'subjectAltName', altNames: [{ type: 7, ip: address }] },
      ],
    });
    identity = { key: pems.private, cert: pems.cert };
  }
  // The file is rewritten when the identity is new or this address wasn't the most recent: this
  // address goes first, then up to three others. Otherwise it is left as it is.
  if (fresh || Object.keys(saved)[0] !== address) {
    const others = Object.entries(saved)
      .filter(([other]) => other !== address)
      .slice(0, 3);
    // Written to a temporary file that replaces the old one in one step, so it is never
    // half-written ('wx' refuses an existing file, and 0600 keeps the key private).
    const temporary = file + `.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ identities: Object.fromEntries([[address, identity], ...others]) }),
        { mode: 0o600, flag: 'wx' },
      );
      fs.renameSync(temporary, file);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
  }
  return {
    address,
    key: identity.key,
    cert: identity.cert,
    fingerprint: new crypto.X509Certificate(identity.cert).fingerprint256,
  };
}

// --- The server ---

/**
 * Starts the sharing server and resolves with its controls once it listens. Rejects when the
 * address isn't private IPv4, the port isn't valid, or the port can't be opened.
 *
 * Options:
 * - address, port: where to listen. The port is 4777 unless given; 0 lets the system choose.
 * - directory: a private folder for the TLS identity and for files arriving from the viewer.
 *   publicDirectory: the viewer page's files (public/).
 * - hostName, platform: this computer's name and operating system, told to the viewer.
 * - authenticate(user, password): resolves whether a sign-in is right (sharing/auth.cjs). Without
 *   it, POST /login answers 404.
 * - isReady(): whether sharing has fully started. Until then sign-ins are refused.
 * - onSignal({ id, message }): the viewer's WebRTC answer or ICE candidate, for the host window.
 * - onPeer(event): { type: 'viewer-joined', id, address, replaced } or { type: 'viewer-left', id }.
 * - onUpload(transfer): a complete file from the viewer, with its `name` (made safe), `size`,
 *   `path` (a private temporary file) and `sessionId`. The temporary file is deleted once the
 *   returned promise settles, so onUpload moves or copies it before then.
 * - log(text): status lines.
 * - now(), freeSpace(directory): the clock and the free disk space, which tests replace.
 *
 * The controls:
 * - url: this server's origin (https://address:port), and fingerprint: its certificate's.
 * - viewerId: the session id of the viewer holding the session, or undefined.
 * - signal(id, message), disconnect(), sendFile(file) and stop(), described below.
 */
async function createLanServer(options) {
  const {
    address,
    port = 4777,
    directory,
    publicDirectory,
    hostName,
    platform,
    onSignal = () => {},
    onPeer = () => {},
    onUpload = () => {},
    isReady = () => true,
    log = () => {},
    now: clock = Date.now,
    authenticate = null,
    freeSpace = freeBytes,
  } = options;
  if (net.isIP(address) !== 4 || !isPrivateAddress(address))
    throw Error('Choose a private IPv4 network address.');
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error('Choose a valid network port.');
  const identity = await credentials(directory, address);
  // The session socket of the signed-in viewer (one at a time), and whether stop() was called.
  let viewer = null,
    stopped = false;
  // The times of recent sign-ins that failed or are still being checked, by address.
  const attempts = new Map();
  // Every open connection, so that stopping can close them all at once.
  const sockets = new Set();
  // The same times from every address together.
  let globalAttempts = [];
  // A successful sign-in returns a one-time ticket that the viewer spends on its session socket.
  const tickets = new Map();
  // Files the host offers to the viewer, by the token in their one-time address.
  const offers = new Map();

  // --- Signing in: POST /login ---

  /**
   * Whether a sign-in from `ip` at time `now` must wait: in the last minute, FAILURES_PER_ADDRESS
   * sign-ins from that address, or FAILURES_IN_ALL from every address, failed or are still being
   * checked. One let through counts from now on, and forgive() takes it back if it succeeds, so
   * only failures spend the limit, and many sent at once can't all pass while they're checked.
   */
  function limited(ip, now) {
    const prior = (attempts.get(ip) || []).filter((time) => now - time < 60000);
    globalAttempts = globalAttempts.filter((time) => now - time < 60000);
    attempts.set(ip, prior);
    if (prior.length >= FAILURES_PER_ADDRESS || globalAttempts.length >= FAILURES_IN_ALL)
      return true;
    prior.push(now);
    globalAttempts.push(now);
    return false;
  }

  /** Takes back the sign-in from `ip` let through at `time`, once its password proved right. */
  function forgive(ip, time) {
    for (const list of [attempts.get(ip), globalAttempts]) {
      const index = list ? list.lastIndexOf(time) : -1;
      if (index >= 0) list.splice(index, 1);
    }
  }

  /**
   * Answers POST /login. The request is JSON { user, password } of at most 4096 characters; the
   * answer is JSON { ticket }, or { error } with a message for the person. The ticket is 64 hex
   * characters, and it works once, within TICKET_MS, from the address that signed in.
   */
  function signIn(req, res, headers) {
    const reply = (status, body) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!authenticate) return reply(404, { error: 'Sign-in is not available on this computer.' });
    // A browser names the page that sent the request (Origin), and only the viewer page itself
    // may sign in from one. The desktop and Android apps sign in without an Origin.
    if (req.headers.origin && req.headers.origin !== origin)
      return reply(403, { error: 'Private-network access only.' });
    // Only JSON. (A page on another site also can't send JSON here without a CORS preflight, which
    // this server never allows.)
    if (!/^application\/json\b/.test(req.headers['content-type'] || ''))
      return reply(415, { error: 'Send the sign-in as JSON.' });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      // Too long for a sign-in: the connection is dropped without an answer.
      if (body.length > 4096) req.destroy();
    });
    req.on('end', async () => {
      try {
        const ip = req.socket.remoteAddress;
        let fields;
        try {
          fields = JSON.parse(body);
        } catch {
          return reply(400, { error: 'Send the sign-in as JSON.' });
        }
        const { user, password } = fields || {};
        if (
          typeof user !== 'string' ||
          typeof password !== 'string' ||
          !user ||
          user.length > 64 ||
          !password ||
          password.length > 1024
        )
          return reply(400, { error: 'Enter a user name and password.' });
        if (!isReady()) return reply(409, { error: 'The host is not sharing yet.' });
        // Only failed sign-ins spend the limit; a right password is forgiven.
        const time = clock();
        if (limited(ip, time)) return reply(429, { error: 'Wait a minute before trying again.' });
        if (!(await authenticate(user, password)))
          return reply(401, { error: 'That user name or password is not correct.' });
        forgive(ip, time);
        // Sharing may have stopped while the password was being checked.
        if (stopped) return reply(409, { error: 'The host stopped sharing.' });
        const ticket = crypto.randomBytes(32).toString('hex');
        tickets.set(ticket, { ip, expires: clock() + TICKET_MS });
        reply(200, { ticket });
      } catch {
        reply(500, { error: 'Sign-in failed on this computer.' });
      }
    });
  }

  // --- Files for the viewer: GET /download/<token> ---

  /**
   * Serves a file the host offered (see sendFile()). An offered file goes once to the viewer it was
   * offered to, from that viewer's address, while it still holds the session: the first request
   * for the address spends it, and a request that doesn't meet those conditions gets 404 and ends
   * the offer, so sendFile() hears it at once instead of holding the next file back until OFFER_MS
   * runs out. The session hears how far it got, at most every 250 ms.
   */
  function serveOffer(token, req, res, headers) {
    const offer = offers.get(token);
    offers.delete(token);
    if (!offer || viewer !== offer.ws || req.socket.remoteAddress !== offer.address) {
      offer?.finish(Error('The file was asked for from another address. Send it again.'));
      res.writeHead(404, headers);
      return res.end('Not found');
    }
    offer.started(res);
    // filename= gets a plain ASCII copy of the name, without quotes, backslashes, % or ;, for
    // clients that don't read filename*=, which carries the exact name in UTF-8 (RFC 6266).
    const plain = offer.name.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': offer.size,
      'Content-Disposition': `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(offer.name)}`,
    });
    // The bytes sent so far, and when the session last heard the count.
    let sent = 0,
      lastReport = 0;
    const stream = fs.createReadStream(offer.file, { highWaterMark: 256 * 1024 });
    stream.on('data', (chunk) => {
      sent += chunk.length;
      // The file grew after it was offered: stop rather than send more than Content-Length.
      if (sent > offer.size) {
        stream.destroy();
        res.destroy();
        return;
      }
      const now = clock();
      if (now - lastReport >= 250) {
        lastReport = now;
        send(offer.ws, { type: 'download-progress', id: offer.id, received: sent });
      }
    });
    stream.on('error', () => res.destroy());
    // The download worked only if the response finished with every byte; anything else fails the
    // offer, and sendFile() tells the viewer.
    res.on('close', () =>
      offer.finish(
        res.writableFinished && sent === offer.size
          ? null
          : Error('The file stopped before the end. Send it again.'),
      ),
    );
    stream.pipe(res);
  }

  // --- HTTPS: the viewer page ---

  // This server's origin, and the Host header that names it. A request naming any other host is
  // refused, so a page from another site whose name points at this address (DNS rebinding) gets
  // nothing. Both are set again after listening, when the port is known.
  let origin = `https://${address}:${port}`;
  let expectedHost = new URL(origin).host;
  // Everything served besides /login and downloads, by URL path: its file in publicDirectory and
  // its type. Nothing else in the folder can be reached.
  const files = {
    '/': ['client.html', 'text/html; charset=utf-8'],
    ...Object.fromEntries(
      CLIENT_SCRIPTS.map((name) => [
        `/client/${name}`,
        [`client/${name}`, 'text/javascript; charset=utf-8'],
      ]),
    ),
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/pixel-icons.js': ['pixel-icons.js', 'text/javascript; charset=utf-8'],
    '/pixel-scene.js': ['pixel-scene.js', 'text/javascript; charset=utf-8'],
    '/keys.js': ['keys.js', 'text/javascript; charset=utf-8'],
    ...Object.fromEntries(
      VIEWER_FONTS.map((name) => [`/fonts/${name}`, [`fonts/${name}`, 'font/woff2']]),
    ),
  };
  const server = https.createServer(
    { key: identity.key, cert: identity.cert, minVersion: 'TLSv1.2' },
    (req, res) => {
      if (
        stopped ||
        !isPrivateAddress(req.socket.remoteAddress) ||
        req.headers.host !== expectedHost
      ) {
        res.writeHead(403);
        return res.end('Private-network access only.');
      }
      // The security headers every answer from here on carries.
      const headers = {
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      };
      if (req.method === 'POST' && req.url === '/login') return signIn(req, res, headers);
      // /download/ and a token of 48 hex characters (see sendFile()).
      if (req.method === 'GET' && /^\/download\/[0-9a-f]{48}$/.test(req.url))
        return serveOffer(req.url.slice(10), req, res, headers);
      if (req.method !== 'GET' || !Object.hasOwn(files, req.url)) {
        res.writeHead(404, headers);
        return res.end('Not found');
      }
      const [file, mime] = files[req.url];
      res.writeHead(200, { ...headers, 'Content-Type': mime });
      fs.createReadStream(path.join(publicDirectory, file))
        .on('error', () => res.destroy())
        .pipe(res);
    },
  );
  // A client has 10 seconds to send its request, and at most 32 connections are open at once.
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxConnections = 32;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  // --- The session socket: a WebSocket at /session ---

  // Messages of at most 100,000 bytes, without compression.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 100000, perMessageDeflate: false });
  // Only the viewer page itself (its Origin), from a private address and naming this server, can
  // open a session socket, and at most 8 are open at once, signed in or not.
  server.on('upgrade', (req, socket, head) => {
    if (
      stopped ||
      req.url !== '/session' ||
      !isPrivateAddress(req.socket.remoteAddress) ||
      req.headers.origin !== origin ||
      req.headers.host !== expectedHost ||
      wss.clients.size >= 8
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  /**
   * Sends one message as JSON on a session socket, and returns whether it went. A viewer with more
   * than 2 MB still waiting to go out isn't keeping up, so its connection is closed instead.
   */
  const send = (ws, data) => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      endConnection(ws, 1008, 'Viewer is not receiving data');
      return false;
    }
    ws.send(JSON.stringify(data));
    return true;
  };

  /** Abandons the file the viewer is sending, if any: closes it and deletes what arrived. */
  function closeUpload(ws) {
    if (!ws.upload) return;
    try {
      fs.closeSync(ws.upload.fd);
    } catch {}
    try {
      fs.unlinkSync(ws.upload.path);
    } catch {}
    ws.upload = null;
  }

  /** If `ws` holds the session, takes it away and tells onPeer the viewer left. */
  function revokeViewer(ws) {
    if (viewer !== ws) return;
    viewer = null;
    ws.authed = false;
    onPeer({ type: 'viewer-left', id: ws.id });
  }

  /** Deletes a file that arrived complete but is still waiting for onUpload, if any. */
  function cleanPendingUpload(ws) {
    if (!ws.pendingUpload) return;
    try {
      fs.unlinkSync(ws.pendingUpload.path);
    } catch {}
    ws.pendingUpload = null;
  }

  /**
   * Ends a session socket: takes away its session, deletes its unfinished files, and closes it with
   * a WebSocket close code: 1000 when the host disconnects, 1008 (policy violation) for a broken
   * limit or a sign-in that took too long, and 4000 when another device took over.
   */
  function endConnection(ws, code, reason) {
    ws.ended = true;
    revokeViewer(ws);
    closeUpload(ws);
    cleanPendingUpload(ws);
    ws.close(code, reason);
  }

  wss.on('connection', (ws, req) => {
    // Each socket's state: its session id and address, whether it answered the last ping, whether
    // it signed in or was ended, and its message counts in the current one-second window.
    ws.id = crypto.randomUUID();
    ws.address = req.socket.remoteAddress;
    ws.alive = true;
    ws.authed = false;
    ws.ended = false;
    ws.windowStart = clock();
    ws.count = 0;
    ws.chunkCount = 0;
    ws.totalCount = 0;
    // A socket has 30 seconds to sign in.
    const timeout = setTimeout(() => {
      if (!ws.authed) endConnection(ws, 1008, 'Sign-in timed out');
    }, 30000);
    // A socket error is followed by 'close', which cleans up; without a listener it would throw.
    ws.on('error', () => {});
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      closeUpload(ws);
      cleanPendingUpload(ws);
      revokeViewer(ws);
    });
    ws.on('message', (raw, binary) => {
      try {
        if (ws.ended || stopped || ws.readyState !== WebSocket.OPEN) return;
        // Per one-second window: at most 4,500 messages of any kind, and within those, 4,000 file
        // chunks from a signed-in viewer and 500 other messages. More ends the connection.
        const now = clock();
        if (now - ws.windowStart > 1000) {
          ws.windowStart = now;
          ws.count = 0;
          ws.chunkCount = 0;
          ws.totalCount = 0;
        }
        if (++ws.totalCount > 4500) {
          endConnection(ws, 1008, 'Message limit');
          return;
        }
        if (binary) throw Error('Use the supported message format.');
        const message = JSON.parse(raw.toString());
        if (!message || typeof message !== 'object') throw Error('Invalid message.');
        const tooMany =
          ws.authed && message.type === 'file-chunk' ? ++ws.chunkCount > 4000 : ++ws.count > 500;
        if (tooMany) {
          endConnection(ws, 1008, 'Message limit');
          return;
        }
        // Before signing in, the only message is { type: 'ticket', ticket }. A ticket is spent the
        // first time it is shown, and it works only before it expires and from the address that
        // signed in.
        if (!ws.authed) {
          const ip = req.socket.remoteAddress;
          if (message.type !== 'ticket') throw Error('Sign in to connect.');
          const entry = typeof message.ticket === 'string' ? tickets.get(message.ticket) : null;
          if (entry) tickets.delete(message.ticket);
          if (!entry || entry.expires <= now || entry.ip !== ip)
            throw Error('Sign in again to connect.');
          if (!isReady()) throw Error('The host is not sharing yet.');
          // The newest sign-in takes over. The current viewer hears why before its connection
          // closes; the viewer page recognizes this message by its exact text.
          const replaced = !!viewer;
          if (viewer) {
            const previous = viewer;
            send(previous, { type: 'replaced' });
            endConnection(previous, 4000, 'Another device connected');
          }
          ws.authed = true;
          viewer = ws;
          clearTimeout(timeout);
          send(ws, { type: 'paired', hostName, platform, declines: true });
          onPeer({ type: 'viewer-joined', id: ws.id, address: ip, replaced });
          return;
        }
        if (viewer !== ws || stopped) throw Error('The session has ended.');
        // WebRTC signaling from the viewer, for the host window.
        if (['answer', 'ice'].includes(message.type)) {
          if (!validSignal(message))
            throw Error('Only private-network WebRTC connections are allowed.');
          onSignal({ id: ws.id, message });
          return;
        }
        // A file from the viewer: file-start { name, size }, answered with file-ready { id }; then
        // file-chunk { id, data } messages with its bytes in base64; then file-end { id },
        // answered with file-done { name }. It is written to a private temporary file as it comes.
        if (message.type === 'file-start') {
          if (ws.upload || ws.pendingUpload) throw Error('Finish saving the current file first.');
          if (!Number.isSafeInteger(message.size) || message.size < 0 || message.size > LIMIT)
            throw Error('Files must be 10 GB or smaller.');
          if (message.size + ROOM > freeSpace(directory))
            throw Error('This computer doesn’t have room for that file.');
          const id = crypto.randomUUID(),
            file = path.join(directory, `incoming-${id}`);
          ws.upload = {
            id,
            path: file,
            // 'wx' creates the file only if it doesn't exist yet, and 0600 keeps it private.
            fd: fs.openSync(file, 'wx', 0o600),
            name: safeFilename(message.name),
            size: message.size,
            received: 0,
          };
          send(ws, { type: 'file-ready', id });
          return;
        }
        if (message.type === 'file-chunk') {
          const transfer = ws.upload;
          // At most 65,536 characters (48 KB of the file) of strict, padded base64. Node's decoder
          // skips characters that aren't base64 instead of failing, so the text is checked first.
          if (
            !transfer ||
            message.id !== transfer.id ||
            typeof message.data !== 'string' ||
            message.data.length > 65536 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.data)
          )
            throw Error('Invalid file chunk.');
          const chunk = Buffer.from(message.data, 'base64');
          if (transfer.received + chunk.length > transfer.size)
            throw Error('File exceeds its declared size.');
          // writeSync may write less than it was given, so it repeats until the chunk is on disk.
          let written = 0;
          while (written < chunk.length) {
            const count = fs.writeSync(transfer.fd, chunk, written, chunk.length - written);
            if (count <= 0) throw Error('The file could not be written.');
            written += count;
          }
          transfer.received += written;
          return;
        }
        if (message.type === 'file-end') {
          const transfer = ws.upload;
          if (!transfer || message.id !== transfer.id || transfer.received !== transfer.size)
            throw Error('The file transfer is incomplete.');
          fs.closeSync(transfer.fd);
          ws.upload = null;
          ws.pendingUpload = transfer;
          send(ws, { type: 'file-done', name: transfer.name });
          // onUpload decides where the file goes (main.cjs asks the person where to save it),
          // unless the session ended meanwhile, and a failure is told to the viewer. Either way the
          // temporary file is deleted afterwards.
          Promise.resolve()
            .then(() => {
              if (viewer !== ws || stopped) return;
              return onUpload({ ...transfer, sessionId: ws.id });
            })
            .catch((error) => send(ws, { type: 'error', message: error.message }))
            .finally(() => {
              try {
                fs.unlinkSync(transfer.path);
              } catch {}
              if (ws.pendingUpload === transfer) ws.pendingUpload = null;
            });
          return;
        }
        // An offered file the viewer can't take now, as when it is still saving the last one: the
        // offer ends at once, and sendFile() says why.
        if (message.type === 'download-decline') {
          for (const offer of offers.values())
            if (offer.ws === ws && offer.id === message.id)
              offer.finish(
                Error('The viewer is still saving another file. Send this one once it has.'),
              );
          return;
        }
        throw Error('Unknown request.');
      } catch (error) {
        // A refused message also abandons a file on its way, and the viewer hears why.
        closeUpload(ws);
        send(ws, { type: 'error', message: error.message });
      }
    });
  });

  // --- Keepalive and cleanup ---

  // Every 15 seconds: a socket that didn't answer the last ping is cut off and the others are
  // pinged again, and sign-in attempts over a minute old and expired tickets are forgotten.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
    for (const [ip, times] of attempts)
      if (times.every((time) => clock() - time >= 60000)) attempts.delete(ip);
    for (const [ticket, entry] of tickets) if (entry.expires <= clock()) tickets.delete(ticket);
  }, 15000);
  // The timer alone doesn't keep the process running.
  heartbeat.unref();

  // --- Listening ---

  // Waits until the server listens. If it can't (for example, the port is taken), everything set
  // up so far is undone and the error is passed on.
  try {
    await new Promise((resolve, reject) => {
      const failed = (error) => {
        server.removeListener('listening', listening);
        reject(error);
      };
      const listening = () => {
        server.removeListener('error', failed);
        resolve();
      };
      server.once('error', failed);
      server.once('listening', listening);
      server.listen(port, address);
    });
  } catch (error) {
    stopped = true;
    clearInterval(heartbeat);
    wss.close();
    for (const socket of sockets) socket.destroy();
    server.close();
    throw error;
  }
  // The real origin, now that the port is known (with port 0 the system chose it).
  origin = new URL(`https://${address}:${server.address().port}`).origin;
  expectedHost = new URL(origin).host;
  // From now on, server errors are only logged.
  server.on('error', (error) => log(`Network listener error: ${error.message}`));
  log('Ready for a viewer on the selected private network.');

  // --- The controls ---

  return {
    url: origin,
    fingerprint: identity.fingerprint,
    get viewerId() {
      return viewer?.id;
    },
    /**
     * Sends the host window's WebRTC offer or ICE candidate to the viewer with session `id`, if
     * it still holds the session and the message passes validSignal().
     */
    signal(id, message) {
      if (viewer?.id === id && validSignal(message)) send(viewer, message);
    },
    /** Ends the viewer's session, if there is one. */
    disconnect() {
      if (viewer) endConnection(viewer, 1000, 'Disconnected by host');
    },
    /**
     * Sends the file at path `file` to the viewer. A file for the viewer is offered as a one-time
     * address on this server, which the viewer's browser saves straight to disk, so a large file
     * never sits in either side's memory. It resolves once the viewer has it all.
     *
     * The viewer hears download-offer { id, name, size, path }, then download-progress { id,
     * received } while it downloads, and finally download-end { id }, or download-error { id,
     * message } when it fails. One file at a time: it rejects when there is no viewer, a file is
     * already on its way, the file is too big, the viewer leaves or declines it, the download
     * breaks, or it doesn't start within OFFER_MS.
     */
    async sendFile(file) {
      const ws = viewer;
      if (!ws || stopped) throw Error('Connect a viewer first.');
      if (ws.downloading) throw Error('Finish sending the current file first.');
      ws.downloading = true;
      // The id the messages use, and the secret part of the address: 24 random bytes in hex.
      const id = crypto.randomUUID(),
        token = crypto.randomBytes(24).toString('hex');
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > LIMIT) throw Error('Files must be 10 GB or smaller.');
        const name = safeFilename(path.basename(file));
        await new Promise((resolve, reject) => {
          // The download's response once it starts, and whether the offer has settled.
          let response = null,
            done = false;
          // Settles the offer, once: forgets it and, on an error, cuts off the download.
          const finish = (error) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            offers.delete(token);
            ws.removeListener('close', closed);
            if (error) {
              response?.destroy();
              reject(error);
            } else resolve();
          };
          const closed = () => finish(Error('Viewer disconnected.'));
          // The viewer has OFFER_MS to start the download. Once it starts, it has no time limit.
          const timer = setTimeout(
            () => finish(Error('The viewer didn’t take the file in time.')),
            OFFER_MS,
          );
          offers.set(token, {
            id,
            ws,
            file,
            name,
            size: stat.size,
            address: ws.address,
            finish,
            // serveOffer() calls it as the download starts.
            started: (res) => {
              response = res;
              clearTimeout(timer);
            },
          });
          ws.once('close', closed);
          send(ws, {
            type: 'download-offer',
            id,
            name,
            size: stat.size,
            path: `/download/${token}`,
          });
        });
        send(ws, { type: 'download-end', id });
      } catch (error) {
        if (viewer === ws && !stopped)
          send(ws, { type: 'download-error', id, message: error.message });
        throw error;
      } finally {
        ws.downloading = false;
      }
    },
    /**
     * Stops sharing: refuses everything from now on, fails the offers, ends every session socket
     * and connection, and resolves once the server has closed.
     */
    async stop() {
      stopped = true;
      clearInterval(heartbeat);
      tickets.clear();
      for (const offer of [...offers.values()]) offer.finish(Error('Sharing stopped.'));
      for (const ws of wss.clients) {
        revokeViewer(ws);
        closeUpload(ws);
        cleanPendingUpload(ws);
        ws.terminate();
      }
      wss.close();
      // Open connections would keep server.close() waiting.
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { createLanServer, credentials, LIMIT };
