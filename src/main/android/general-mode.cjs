'use strict';
// General mode for Android devices, the computer's side. A device running the Yes Machine app shares its screen over
// the network (android/app, ShareService.java) once the person there allows this computer. The computer connects over
// TLS with a certificate of its own, which the device can remember as always allowed, and checks the device's
// certificate against the one the person here verified the first time, as for computers. After the device allows it,
// the stream is the same as advanced mode's (protocol.cjs).
//
// main.cjs creates one of these. Discovery (network/discovery.cjs) supplies the devices that announce themselves on
// the network, the page checks and approves a device's certificate through inspect() and trust(), and windows.cjs
// opens the session with connect().
//
// The handshake, after TLS: this computer sends its hello ("YMC1", see hello()), and the device answers one byte. 1
// means it is asking its person, and another answer follows. 2 means allowed, and the stream follows at once. 0
// (denied) and 3 (another computer is in control) are each followed by a 2-byte length and a reason.
const crypto = require('node:crypto');
const tls = require('node:tls');
const selfsigned = require('selfsigned');
const { readJson, writePrivateJson } = require('../system/private-json.cjs');

// The device's answers to the hello.
const DENIED = 0,
  ASKING = 1,
  ALLOWED = 2,
  BUSY = 3;
// How long to wait to reach the device, and then for its first answer; and how long once it is asking its person.
const REACH_TIME = 10 * 1000,
  ANSWER_TIME = 75 * 1000; // the device asks its person for up to a minute

// --- This computer's certificate and hello ---

/**
 * This computer's certificate for devices, made once and kept with the app's private files. Devices remember its
 * fingerprint, so it lasts ten years. A saved one is used while it has more than a day left; otherwise (there is none
 * yet, it can't be read, or it is about to expire) a new self-signed one is made and saved. Resolves with {key, cert}
 * in PEM.
 */
async function loadIdentity(file) {
  const saved = readJson(file, null);
  try {
    if (Date.parse(new crypto.X509Certificate(saved.cert).validTo) > Date.now() + 86400000)
      return { key: saved.key, cert: saved.cert };
  } catch {
    /* none yet, or unreadable */
  }
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Yes Machine computer' }], {
    keySize: 2048,
    algorithm: 'sha256',
    days: 3650,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', clientAuth: true },
    ],
  });
  const identity = { key: pems.private, cert: pems.cert };
  writePrivateJson(file, identity);
  return identity;
}

/** The hello this computer sends first: "YMC1", then a 2-byte length and JSON with its name and system. */
function hello(name, system) {
  const json = Buffer.from(JSON.stringify({ name, system }), 'utf8');
  const header = Buffer.alloc(6);
  header.write('YMC1', 0, 'latin1');
  header.writeUInt16BE(json.length, 4);
  return Buffer.concat([header, json]);
}

// --- The device's answer ---

/**
 * Waits for the device's answer: asking (its person is deciding), then allowed, or denied or busy with a reason.
 * Once allowed, the socket is paused with the stream's first bytes put back, for whoever reads the stream next.
 *
 * Resolves when allowed. Rejects, and destroys the socket, when the device denies (error.code 'denied') or is busy
 * ('busy'), sends an answer this computer doesn't know, closes the connection or takes too long, and when signal
 * aborts. onAsking() hears when the device starts asking its person.
 */
function awaitAnswer(socket, device, onAsking, signal) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0),
      timer = null,
      done = false;
    // Settles once, and takes every listener away.
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener('data', data);
      socket.removeListener('close', closed);
      socket.removeListener('error', closed);
      signal?.removeEventListener('abort', closed);
      if (error) {
        socket.destroy();
        reject(error);
      } else resolve();
    };
    // Starts the time the device has for its next answer.
    const wait = (milliseconds) => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(Error(`${device.name} didn’t answer.`)), milliseconds);
    };
    const closed = () =>
      finish(Error(signal?.aborted ? 'Canceled.' : `${device.name} closed the connection.`));
    function data(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        const status = buffer[0];
        if (status === ASKING) {
          buffer = buffer.subarray(1);
          wait(ANSWER_TIME);
          onAsking();
          continue;
        }
        // Paused, so nothing of the stream is lost before its reader listens. Whatever came after the answer is put
        // back, to be read first.
        if (status === ALLOWED) {
          socket.pause();
          if (buffer.length > 1) socket.unshift(buffer.subarray(1));
          finish();
          return;
        }
        if (status !== DENIED && status !== BUSY) {
          finish(Error(`${device.name} sent an answer Yes Machine doesn’t know.`));
          return;
        }
        // The reason is read to its end, but the message names the device instead.
        if (buffer.length < 3 || buffer.length < 3 + buffer.readUInt16BE(1)) return;
        finish(
          Object.assign(
            Error(
              status === BUSY
                ? `Another computer is using ${device.name}.`
                : `${device.name} didn’t allow this computer.`,
            ),
            { code: status === BUSY ? 'busy' : 'denied' },
          ),
        );
        return;
      }
    }
    socket.on('data', data);
    socket.once('close', closed);
    socket.once('error', closed);
    signal?.addEventListener('abort', closed);
    if (signal?.aborted) closed();
    else wait(REACH_TIME);
  });
}

// --- Devices and sessions ---

/**
 * Creates general mode.
 *
 * Options:
 * - identityFile: where this computer's certificate is kept.
 * - store: the approved certificates (network/trust.cjs), with get(key) and set(key, fingerprint, details).
 * - name and system: how this computer introduces itself to devices.
 * - connectTls: tls.connect, unless a test passes its own.
 *
 * Returns {setDevices, devices, inspect, trust, connect}. The devices come from discovery, each with an id, name,
 * address and port.
 */
function createAndroidShare({ identityFile, store, name, system, connectTls = tls.connect }) {
  let devices = [],
    identity = null;
  const seen = new Map(); // device id -> the fingerprint this process just saw
  // This computer's certificate, loaded once. A load that fails is forgotten, so the next call tries again.
  const ownIdentity = () =>
    identity ||
    (identity = loadIdentity(identityFile).catch((error) => {
      identity = null;
      throw error;
    }));
  // Approvals are kept by the device's address and port.
  const keyOf = (device) => `${device.address}:${device.port}`;
  /** The sharing device with this id, or an error when it stopped sharing. */
  function find(id) {
    const device = devices.find((each) => each.id === id);
    if (!device) throw Error('That device stopped sharing.');
    return device;
  }

  /**
   * A TLS connection to the device with this computer's certificate. The device's own certificate is checked by the
   * caller: it is self-signed, so TLS doesn't check it (rejectUnauthorized is off), and the caller compares its
   * fingerprint instead. Gives up after REACH_TIME.
   */
  async function reach(device) {
    const { key, cert } = await ownIdentity();
    return new Promise((resolve, reject) => {
      const socket = connectTls({
        host: device.address,
        port: device.port,
        key,
        cert,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
      });
      const timer = setTimeout(() => socket.destroy(Error('timeout')), REACH_TIME);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        socket.removeListener('error', failed);
        socket.on('error', () => {});
        resolve(socket);
      });
      function failed() {
        clearTimeout(timer);
        reject(
          Error(`Can’t reach ${device.name}. Check that it’s still sharing and on this network.`),
        );
      }
      socket.once('error', failed);
    });
  }
  /** The SHA-256 fingerprint of the certificate the device showed, or '' when it showed none. */
  const fingerprintOf = (socket) =>
    socket.getPeerX509Certificate?.()?.fingerprint256 ||
    socket.getPeerCertificate()?.fingerprint256 ||
    '';

  /**
   * The device's certificate, and whether the person here approved it before. Connects only to read the certificate,
   * which is then the one trust() can approve. Resolves with {fingerprint, trusted, changed}, where changed means a
   * different certificate was approved for this address and port before.
   */
  async function inspect(id) {
    const device = find(id),
      socket = await reach(device),
      fingerprint = fingerprintOf(socket);
    socket.destroy();
    if (!fingerprint) throw Error(`${device.name} showed no certificate.`);
    seen.set(id, fingerprint);
    const approved = store.get(keyOf(device));
    return {
      fingerprint,
      trusted: approved === fingerprint,
      changed: !!approved && approved !== fingerprint,
    };
  }

  /**
   * Approves the device's certificate, with its name and system for Settings' list. Only a fingerprint this process
   * just saw can be approved, never one the page supplies.
   */
  function trust(id) {
    const device = find(id),
      fingerprint = seen.get(id);
    if (!fingerprint) throw Error('Check the device again before trusting it.');
    store.set(keyOf(device), fingerprint, {
      name: device.name,
      system: device.system || 'Android',
    });
  }

  /**
   * Connects to a device whose certificate was approved, says who this computer is, and waits for the person there
   * to allow it; onAsking hears when the device asks them, and signal can cancel the wait. Returns the session as
   * advanced mode does: the device, the socket, paused with the stream's first bytes, close(), and openFiles().
   */
  async function connect(id, { onAsking = () => {}, signal } = {}) {
    const device = find(id),
      socket = await reach(device),
      fingerprint = fingerprintOf(socket);
    if (!fingerprint || store.get(keyOf(device)) !== fingerprint) {
      socket.destroy();
      throw Error(
        `${device.name} shows a certificate you haven’t verified. Double-click it to check it again.`,
      );
    }
    // Input messages are small, and each should go at once rather than wait to be sent with others.
    socket.setNoDelay(true);
    socket.write(hello(name, system));
    await awaitAnswer(socket, device, onAsking, signal);
    let closed = false; // a broken connection also closes, and closing ends the session
    const others = new Set();
    const close = () => {
      if (!closed) {
        closed = true;
        socket.destroy();
        for (const other of others) other.destroy();
      }
    };
    socket.once('close', close);
    // Files have a connection of their own, checked the same way; the device takes it only from the computer it let in.
    // close() ends it too.
    async function openFiles() {
      if (closed) throw Error('The session has ended.');
      const files = await reach(device);
      if (fingerprintOf(files) !== fingerprint) {
        files.destroy();
        throw Error(`${device.name} showed a different certificate.`);
      }
      others.add(files);
      files.once('close', () => others.delete(files));
      if (closed) files.destroy();
      return files;
    }
    return { device, socket, close, openFiles };
  }

  return {
    setDevices(list) {
      devices = Array.isArray(list) ? list : [];
    },
    devices: () => devices,
    inspect,
    trust,
    connect,
  };
}

module.exports = { createAndroidShare, loadIdentity, hello, DENIED, ASKING, ALLOWED, BUSY };
