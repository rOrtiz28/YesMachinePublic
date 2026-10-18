'use strict';
// The wire protocol of Android sessions, the computer's side, the same in both modes: advanced mode's stream server
// (android/stream, Server.java) and general mode's Yes Machine app (android/app, ShareService.java) send the same
// stream and read the same input. The device sends a header and then typed messages; the computer sends input.
// Everything is big-endian. The computer checks both ways: what the device sends must parse, and what the viewer page
// asks to send must be in range. windows.cjs uses the stream and input parts (and fileHello), and files.cjs the rest
// of the file connection's.
//
// The stream, device to computer. First the header: "YMS1", the width and height (4 bytes each), the length of the
// encoder's name (4 bytes, at most 256) and the name. Then messages, each starting with its type byte:
//   1 video      capture time in microseconds (8 bytes), flags (1 byte, MediaCodec's), length (4 bytes), H.264 data
//   2 pong       the ping's time and the device's clock (8 bytes each), answering the pings that only the measuring
//                tool (tools/android-stream) sends
//   3 sound      length (4 bytes), then 48 kHz stereo 16-bit PCM, little-endian
//   5 size       the new screen width and height (4 bytes each); the video restarts with a new configuration
//   6 ended      advanced mode only: why the server ended the session (1 byte; 1: the app switched to general mode)
//   7 clipboard  length (4 bytes), then the text copied on the device (UTF-8)
//
// Input, computer to device, each message also starting with its type byte:
//   2 ping              the sender's time (8 bytes); only the measuring tool sends it
//   4 touch             action (1 byte: 0 down, 1 up, 2 move), then x and y as fractions of the screen (4-byte floats)
//   6 scroll            x, y, horizontal and vertical amounts (4-byte floats)
//   7 key               action (1 byte: 0 down, 1 up), Android key code and meta state (4 bytes each)
//   8 text              length (4 bytes), then UTF-8 text for the device to type
//   9 keyboard          1 lets the device show its own on-screen keyboard, 0 hides it
//   10 clipboard        length (4 bytes), then text copied on the computer (UTF-8)
//   11 clipboard-report 1 or 0: whether the device should report what is copied on it
//   12 clipboard-check  no more bytes: look at the device's clipboard now

// Copied text goes across up to 60 KB, as with the computers' shared clipboard.
const CLIPBOARD_LIMIT = 60000;

// --- The stream ---

/**
 * Splits the device's byte stream into messages: the header, then video, sound, size, end and clipboard messages.
 * Pongs, which answer the pings only the measuring tool sends, are skipped.
 *
 * onMessage gets {type: 'header', width, height, encoder}, then {type: 'video', pts, flags, data}, {type: 'sound',
 * data}, {type: 'size', width, height}, {type: 'ended', reason: 'general' | 'other'} and {type: 'clipboard', text}.
 * Returns the function to call with each chunk as it arrives. Chunks can split messages anywhere; what is incomplete
 * waits for the next chunk. It throws when the stream isn't Yes Machine's, holds a message that is too large, or has
 * an unknown type, and the caller then ends the session.
 */
function createParser(onMessage) {
  let buffer = Buffer.alloc(0),
    header = false;
  return (chunk) => {
    // With nothing waiting, the chunk itself is the buffer, without a copy.
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (true) {
      if (!header) {
        if (buffer.length < 16) return;
        const length = buffer.readInt32BE(12);
        if (buffer.toString('latin1', 0, 4) !== 'YMS1' || length < 0 || length > 256)
          throw Error('The device sent an unexpected stream.');
        if (buffer.length < 16 + length) return;
        onMessage({
          type: 'header',
          width: buffer.readInt32BE(4),
          height: buffer.readInt32BE(8),
          encoder: buffer.toString('utf8', 16, 16 + length),
        });
        buffer = buffer.subarray(16 + length);
        header = true;
        continue;
      }
      if (!buffer.length) return;
      const type = buffer[0];
      // Data is copied out of the buffer (Buffer.from), so a message keeps its bytes after the parser moves on.
      if (type === 1) {
        if (buffer.length < 14) return;
        const size = buffer.readInt32BE(10);
        if (size < 0 || size > 16 * 1024 * 1024)
          throw Error('The device sent a frame that is too large.');
        if (buffer.length < 14 + size) return;
        onMessage({
          type: 'video',
          pts: Number(buffer.readBigInt64BE(1)),
          flags: buffer[9],
          data: Buffer.from(buffer.subarray(14, 14 + size)),
        });
        buffer = buffer.subarray(14 + size);
      } else if (type === 2) {
        if (buffer.length < 17) return;
        buffer = buffer.subarray(17);
      } else if (type === 3) {
        // Sound: 48 kHz stereo 16-bit PCM, little-endian, as the device records it.
        if (buffer.length < 5) return;
        const size = buffer.readInt32BE(1);
        if (size < 0 || size > 1024 * 1024 || size % 4)
          throw Error('The device sent sound Yes Machine can’t play.');
        if (buffer.length < 5 + size) return;
        onMessage({ type: 'sound', data: Buffer.from(buffer.subarray(5, 5 + size)) });
        buffer = buffer.subarray(5 + size);
      } else if (type === 5) {
        if (buffer.length < 9) return;
        onMessage({ type: 'size', width: buffer.readInt32BE(1), height: buffer.readInt32BE(5) });
        buffer = buffer.subarray(9);
      } else if (type === 6) {
        // The device ends the session, saying why: 1 when its Yes Machine app switched to general mode.
        if (buffer.length < 2) return;
        onMessage({ type: 'ended', reason: buffer[1] === 1 ? 'general' : 'other' });
        buffer = buffer.subarray(2);
      } else if (type === 7) {
        // What was copied on the device, for the shared clipboard.
        if (buffer.length < 5) return;
        const size = buffer.readInt32BE(1);
        if (size < 0 || size > CLIPBOARD_LIMIT)
          throw Error('The device sent too much copied text.');
        if (buffer.length < 5 + size) return;
        onMessage({ type: 'clipboard', text: buffer.toString('utf8', 5, 5 + size) });
        buffer = buffer.subarray(5 + size);
      } else {
        throw Error(`The device sent an unknown message (${type}).`);
      }
    }
  };
}

// --- Input ---

/**
 * The bytes for one input message from the viewer page, or null when it isn't valid. The page sends:
 * - {type: 'touch', action: 0 | 1 | 2, x, y}, with x and y from 0 to 1
 * - {type: 'scroll', x, y, horizontal, vertical}, with amounts up to 20 either way
 * - {type: 'key', action: 0 | 1, code, meta}, with an Android key code from 1 to 399 and a meta state from 0 to
 *   0x7fffffff
 * - {type: 'keyboard', show: boolean}
 * - {type: 'text', value}, from 1 to 2000 characters
 * - {type: 'clipboard', text}, up to CLIPBOARD_LIMIT bytes of UTF-8
 * - {type: 'clipboard-report', on: boolean} and {type: 'clipboard-check'}
 */
function encodeInput(message) {
  const fraction = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const amount = (value) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 20;
  if (!message || typeof message !== 'object') return null;
  if (
    message.type === 'touch' &&
    [0, 1, 2].includes(message.action) &&
    fraction(message.x) &&
    fraction(message.y)
  ) {
    const bytes = Buffer.alloc(10);
    bytes.writeUInt8(4, 0);
    bytes.writeUInt8(message.action, 1);
    bytes.writeFloatBE(message.x, 2);
    bytes.writeFloatBE(message.y, 6);
    return bytes;
  }
  if (
    message.type === 'scroll' &&
    fraction(message.x) &&
    fraction(message.y) &&
    amount(message.horizontal) &&
    amount(message.vertical)
  ) {
    const bytes = Buffer.alloc(17);
    bytes.writeUInt8(6, 0);
    bytes.writeFloatBE(message.x, 1);
    bytes.writeFloatBE(message.y, 5);
    bytes.writeFloatBE(message.horizontal, 9);
    bytes.writeFloatBE(message.vertical, 13);
    return bytes;
  }
  if (
    message.type === 'key' &&
    [0, 1].includes(message.action) &&
    Number.isInteger(message.code) &&
    message.code > 0 &&
    message.code < 400 &&
    Number.isInteger(message.meta) &&
    message.meta >= 0 &&
    message.meta <= 0x7fffffff
  ) {
    const bytes = Buffer.alloc(10);
    bytes.writeUInt8(7, 0);
    bytes.writeUInt8(message.action, 1);
    bytes.writeInt32BE(message.code, 2);
    bytes.writeInt32BE(message.meta, 6);
    return bytes;
  }
  if (message.type === 'keyboard' && typeof message.show === 'boolean')
    return Buffer.from([9, message.show ? 1 : 0]);
  if (
    message.type === 'text' &&
    typeof message.value === 'string' &&
    message.value.length > 0 &&
    message.value.length <= 2000
  ) {
    const text = Buffer.from(message.value, 'utf8');
    const bytes = Buffer.alloc(5 + text.length);
    bytes.writeUInt8(8, 0);
    bytes.writeInt32BE(text.length, 1);
    text.copy(bytes, 5);
    return bytes;
  }
  // The shared clipboard: text copied here, for the device's clipboard; whether the device should report what is
  // copied there; and a request to look at its clipboard now.
  if (message.type === 'clipboard' && typeof message.text === 'string' && message.text) {
    const text = Buffer.from(message.text, 'utf8');
    if (text.length > CLIPBOARD_LIMIT) return null;
    const bytes = Buffer.alloc(5 + text.length);
    bytes.writeUInt8(10, 0);
    bytes.writeInt32BE(text.length, 1);
    text.copy(bytes, 5);
    return bytes;
  }
  if (message.type === 'clipboard-report' && typeof message.on === 'boolean')
    return Buffer.from([11, message.on ? 1 : 0]);
  if (message.type === 'clipboard-check') return Buffer.from([12]);
  return null;
}

// --- The file connection ---
//
// Files have a connection of their own beside the stream, so a large file never holds up the picture or a touch. The
// computer opens it with "YMF1", a 2-byte length and JSON with its name and system (fileHello). Then either side sends
// files the same way, each message starting with its type byte:
//   1 open    8-byte size, 2-byte name length, the name (UTF-8)
//   2 data    4-byte length, the bytes
//   3 close   0 complete, 1 canceled
// and the side that received a file answers:
//   4 result  0 saved, 1 failed; then a 2-byte length and the name it was saved as, or why not
const FILE_OPEN = 1,
  FILE_DATA = 2,
  FILE_CLOSE = 3,
  FILE_RESULT = 4;
// The size of the data messages this computer sends, and the largest file either way.
const FILE_CHUNK = 64 * 1024,
  FILE_LIMIT = 10 * 1024 ** 3;

/** The hello that opens the file connection: "YMF1", a 2-byte length and JSON with this computer's name and system. */
function fileHello(name, system) {
  const json = Buffer.from(JSON.stringify({ name, system }), 'utf8');
  const header = Buffer.alloc(6);
  header.write('YMF1', 0, 'latin1');
  header.writeUInt16BE(json.length, 4);
  return Buffer.concat([header, json]);
}

// A message of its type byte, one more byte, a 2-byte length and text, cut to 400 characters.
const shortText = (type, first, text) => {
  const bytes = Buffer.from(String(text).slice(0, 400), 'utf8');
  const message = Buffer.alloc(4 + bytes.length);
  message.writeUInt8(type, 0);
  message.writeUInt8(first, 1);
  message.writeUInt16BE(bytes.length, 2);
  bytes.copy(message, 4);
  return message;
};
/** The open message for a file of size bytes. The name is cut to 1024 bytes of UTF-8. */
function fileOpen(name, size) {
  const bytes = Buffer.from(String(name), 'utf8').subarray(0, 1024);
  const message = Buffer.alloc(11 + bytes.length);
  message.writeUInt8(FILE_OPEN, 0);
  message.writeBigUInt64BE(BigInt(size), 1);
  message.writeUInt16BE(bytes.length, 9);
  bytes.copy(message, 11);
  return message;
}
/** A data message carrying chunk. */
function fileData(chunk) {
  const header = Buffer.alloc(5);
  header.writeUInt8(FILE_DATA, 0);
  header.writeUInt32BE(chunk.length, 1);
  return Buffer.concat([header, chunk]);
}
// The close message: the whole file was sent, or it was canceled.
const fileClose = (canceled) => Buffer.from([FILE_CLOSE, canceled ? 1 : 0]);
// The answer to a received file: saved, with the name it was saved as, or failed, with why.
const fileResult = (saved, text) => shortText(FILE_RESULT, saved ? 0 : 1, text);

/**
 * Splits what the device sends on the file connection into messages. Data is checked against the limit for a chunk.
 *
 * onMessage gets {type: 'open', size, name}, {type: 'data', data}, {type: 'close', canceled} and {type: 'result',
 * saved, text}. Returns the function to call with each chunk. It throws on a file larger than FILE_LIMIT, a data
 * message larger than four of this computer's chunks, or an unknown type, and the caller then closes the connection.
 */
function createFileParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (buffer.length) {
      const type = buffer[0];
      if (type === FILE_OPEN) {
        if (buffer.length < 11) return;
        const length = buffer.readUInt16BE(9);
        if (buffer.length < 11 + length) return;
        const size = buffer.readBigUInt64BE(1);
        if (size > BigInt(FILE_LIMIT)) throw Error('The device offered a file larger than 10 GB.');
        onMessage({
          type: 'open',
          size: Number(size),
          name: buffer.toString('utf8', 11, 11 + length),
        });
        buffer = buffer.subarray(11 + length);
      } else if (type === FILE_DATA) {
        if (buffer.length < 5) return;
        const length = buffer.readUInt32BE(1);
        if (length > 4 * FILE_CHUNK) throw Error('The device sent a file chunk that is too large.');
        if (buffer.length < 5 + length) return;
        onMessage({ type: 'data', data: Buffer.from(buffer.subarray(5, 5 + length)) });
        buffer = buffer.subarray(5 + length);
      } else if (type === FILE_CLOSE) {
        if (buffer.length < 2) return;
        onMessage({ type: 'close', canceled: buffer[1] !== 0 });
        buffer = buffer.subarray(2);
      } else if (type === FILE_RESULT) {
        if (buffer.length < 4) return;
        const length = buffer.readUInt16BE(2);
        if (buffer.length < 4 + length) return;
        onMessage({
          type: 'result',
          saved: buffer[1] === 0,
          text: buffer.toString('utf8', 4, 4 + length),
        });
        buffer = buffer.subarray(4 + length);
      } else {
        throw Error(`The device sent an unknown file message (${type}).`);
      }
    }
  };
}

module.exports = {
  createParser,
  encodeInput,
  createFileParser,
  fileHello,
  fileOpen,
  fileData,
  fileClose,
  fileResult,
  CLIPBOARD_LIMIT,
  FILE_CHUNK,
  FILE_LIMIT,
};
