'use strict';
// Files between this computer and an Android device it controls, over the device's file connection (protocol.cjs).
// Files sent from here go one after another, read from where they are on disk at the connection's own pace, and the
// device keeps each in its Download folder. A file the device shares arrives in a private folder here, and then this
// computer asks where to keep it, as for a file from a viewer.
//
// windows.cjs starts one channel per device window, on the connection the session's openFiles() gives, and shows the
// channel's events in the window. One file goes each way at a time: files to send wait in a queue, and the device
// sends its files one after another.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { cutText } = require('../network/security.cjs');
const {
  createFileParser,
  fileOpen,
  fileData,
  fileClose,
  fileResult,
  FILE_CHUNK,
  FILE_LIMIT,
} = require('./protocol.cjs');

const ROOM = 256 * 1024 * 1024; // what a file from the device must leave free on this computer's disk
const REPORT_EVERY = 200; // milliseconds between progress reports

/** The bytes free for this user on the disk that holds directory. */
function freeBytes(directory) {
  const disk = fs.statfsSync(directory);
  return disk.bavail * disk.bsize;
}

/**
 * A name the device sent, made safe to use as a file name here: only its last part is kept, control characters and
 * the ones Windows doesn't allow in names become "_", and it is cut to 180 characters, never through an emoji. An
 * empty name, "." or ".." becomes "file".
 */
function safeName(name) {
  const last = String(name)
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .trim();
  const clean = cutText(last, 180);
  return clean && clean !== '.' && clean !== '..' ? clean : 'file';
}

/**
 * Runs the file connection with a device, both ways.
 *
 * - socket: the file connection, already introduced with fileHello.
 * - directory: the private folder where files from the device arrive. It is made if it's missing.
 * - freeSpace(directory): the free bytes there (freeBytes, unless a test passes its own).
 * - onEvent hears every change, for the window: { type: 'file', direction: 'out' | 'in', id, name, size, done, state },
 *   with a detail for some states. Sending: waiting, sending, sent (detail: the name the device saved it as) or
 *   failed (detail: why). Receiving: receiving, then received, which goes to onReceived with the file's path, or
 *   failed.
 * - onReceived({id, name, size, path}) gets each complete file from the device. The file is deleted from here once
 *   what onReceived returns has settled, so it must be moved or copied by then.
 *
 * Returns {send(files), close(), busy}.
 */
function createFileChannel({
  socket,
  directory,
  freeSpace = freeBytes,
  onEvent = () => {},
  onReceived = () => {},
}) {
  // queue: the files waiting to be sent. sending: the one being sent. receiving: the one coming in, marked refused
  // when it was turned down. result: settles with the device's answer about the file being sent, and is null once
  // the device answered.
  const queue = [];
  let sending = null,
    receiving = null,
    result = null,
    closed = false;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  // --- Reporting ---

  /** Tells onEvent where a transfer stands. */
  function tell(transfer, state, detail) {
    onEvent({
      type: 'file',
      direction: transfer.direction,
      id: transfer.id,
      name: transfer.name,
      size: transfer.size,
      done: transfer.done,
      state,
      ...(detail ? { detail } : {}),
    });
  }
  /** Reports progress at most every REPORT_EVERY milliseconds, and always once the transfer is complete. */
  function throttled(transfer, state) {
    const now = Date.now();
    if (now - (transfer.reported || 0) < REPORT_EVERY && transfer.done < transfer.size) return;
    transfer.reported = now;
    tell(transfer, state);
  }

  // --- Sending ---

  /**
   * Writes as fast as the connection takes it, and no faster: resolves at once while the socket has room, and
   * otherwise once it drains. Rejects when the connection is gone.
   */
  function write(bytes) {
    if (closed) return Promise.reject(Error('The device disconnected.'));
    if (socket.write(bytes)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = (error) => {
        socket.removeListener('drain', drained);
        socket.removeListener('close', gone);
        error ? reject(error) : resolve();
      };
      const drained = () => done(),
        gone = () => done(Error('The device disconnected.'));
      socket.once('drain', drained);
      socket.once('close', gone);
    });
  }

  /** Queues files ({path, name, size}) to send to the device. Each is reported as waiting until its turn. */
  function send(files) {
    for (const file of files) {
      const transfer = {
        direction: 'out',
        id: crypto.randomUUID(),
        path: file.path,
        name: safeName(file.name || path.basename(file.path)),
        size: Number(file.size) || 0,
        done: 0,
      };
      queue.push(transfer);
      tell(transfer, 'waiting');
    }
    pump();
  }

  /** Sends the next file in the queue, unless one is being sent, and then the one after it. */
  async function pump() {
    if (sending || closed || !queue.length) return;
    const transfer = (sending = queue.shift());
    try {
      tell(transfer, 'sending');
      const answer = await upload(transfer);
      tell(
        transfer,
        answer.saved ? 'sent' : 'failed',
        answer.text || (answer.saved ? transfer.name : 'The device didn’t save it.'),
      );
    } catch (error) {
      tell(transfer, 'failed', error.message);
    } finally {
      sending = null;
      pump();
    }
  }

  /**
   * Sends one file: open, its data in FILE_CHUNK pieces read from disk as the connection takes them, then close.
   * Resolves with the device's answer ({saved, text}). The size sent is the file's own, read here.
   */
  async function upload(transfer) {
    const handle = await fs.promises.open(transfer.path, 'r');
    let opened = false;
    try {
      const stats = await handle.stat(),
        size = stats.size;
      if (!stats.isFile()) throw Error('Only files can be sent.');
      if (size > FILE_LIMIT) throw Error('Files must be 10 GB or smaller.');
      transfer.size = size;
      const answered = new Promise((resolve, reject) => {
        result = { resolve, reject };
      });
      answered.catch(() => {}); // read below, or never if the file fails first
      await write(fileOpen(transfer.name, size));
      opened = true;
      const buffer = Buffer.alloc(FILE_CHUNK);
      // The device can turn the file down at any point, such as when it has no room; the rest isn't sent then.
      while (transfer.done < size && result) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(FILE_CHUNK, size - transfer.done),
          transfer.done,
        );
        if (!bytesRead) throw Error('The file got shorter while it was being sent.');
        await write(fileData(Buffer.from(buffer.subarray(0, bytesRead))));
        transfer.done += bytesRead;
        throttled(transfer, 'sending');
      }
      // Canceled when the device answered before the end, which means it turned the file down.
      await write(fileClose(!result));
      opened = false;
      return await answered;
    } catch (error) {
      // The device was told about a file that won't arrive whole.
      if (opened && !closed) socket.write(fileClose(true));
      throw error;
    } finally {
      result = null;
      await handle.close();
    }
  }

  // --- Receiving ---

  /** Closes and deletes a file that didn't arrive whole. */
  function discard(transfer) {
    try {
      fs.closeSync(transfer.fd);
    } catch {
      /* closed already */
    }
    fs.rmSync(transfer.path, { force: true });
  }

  // Each message from the device: the answer about the file being sent, or a part of the file it is sending.
  const parse = createFileParser((message) => {
    if (message.type === 'result') {
      const waiting = result;
      result = null;
      waiting?.resolve(message);
      return;
    }
    // A new file. Without room for it here (it must leave ROOM free), it is turned down at once, and the rest of it is
    // ignored until its close. Otherwise it goes to a new private file in the directory.
    if (message.type === 'open') {
      if (receiving) throw Error('The device started a second file at once.');
      const transfer = {
        direction: 'in',
        id: crypto.randomUUID(),
        name: safeName(message.name),
        size: message.size,
        done: 0,
      };
      if (message.size + ROOM > freeSpace(directory)) {
        receiving = { ...transfer, refused: true };
        socket.write(fileResult(false, 'This computer doesn’t have room for that file.'));
        tell(transfer, 'failed', 'This computer doesn’t have room for that file.');
        return;
      }
      transfer.path = path.join(directory, `incoming-${transfer.id}`);
      transfer.fd = fs.openSync(transfer.path, 'wx', 0o600);
      receiving = transfer;
      tell(transfer, 'receiving');
      return;
    }
    const transfer = receiving;
    if (!transfer) throw Error('The device sent part of a file it never started.');
    if (transfer.refused) {
      if (message.type === 'close') receiving = null;
      return;
    }
    if (message.type === 'data') {
      if (transfer.done + message.data.length > transfer.size)
        throw Error('The device sent more than the file’s size.');
      // writeSync can write less than it was given, so it goes on from where it stopped.
      for (let written = 0; written < message.data.length;)
        written += fs.writeSync(transfer.fd, message.data, written);
      transfer.done += message.data.length;
      throttled(transfer, 'receiving');
      return;
    }
    // close: a canceled or short file is deleted. A whole one is acknowledged with its name and handed to onReceived,
    // and deleted from here once onReceived is done with it.
    receiving = null;
    if (message.canceled || transfer.done !== transfer.size) {
      discard(transfer);
      tell(
        transfer,
        'failed',
        message.canceled ? 'The device stopped sending it.' : 'The file arrived incomplete.',
      );
      return;
    }
    fs.closeSync(transfer.fd);
    socket.write(fileResult(true, transfer.name));
    tell(transfer, 'received');
    Promise.resolve(
      onReceived({
        id: transfer.id,
        name: transfer.name,
        size: transfer.size,
        path: transfer.path,
      }),
    )
      .catch(() => {})
      .finally(() => fs.rmSync(transfer.path, { force: true }));
  });

  // --- The connection ---

  // Anything malformed, or a problem saving it, ends the connection.
  socket.on('data', (chunk) => {
    try {
      parse(chunk);
    } catch {
      socket.destroy();
    }
  });
  // When the connection goes, everything under way fails: the file being sent, the one coming in (deleted) and the
  // files waiting.
  socket.once('close', () => {
    closed = true;
    result?.reject(Error('The device disconnected.'));
    result = null;
    if (receiving) {
      if (!receiving.refused) {
        discard(receiving);
        tell(receiving, 'failed', 'The device disconnected.');
      }
      receiving = null;
    }
    for (const transfer of queue.splice(0)) tell(transfer, 'failed', 'The device disconnected.');
  });

  return {
    send,
    close() {
      socket.destroy();
    },
    // Whether a file is being sent, waiting to be sent or coming in.
    get busy() {
      return Boolean(sending || queue.length || receiving);
    },
  };
}

module.exports = { createFileChannel, safeName, ROOM };
