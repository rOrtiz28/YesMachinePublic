'use strict';

// Tests advanced mode's wire protocol, the computer's side (src/main/android/protocol.cjs): reading the stream the
// device's stream server sends, encoding the input sent back, the shared clipboard's messages, and the separate file
// connection. The device's messages are built here byte by byte, as Server.java writes them, so no device is
// needed. The numbers in every message are big-endian.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../../src/main/android/protocol.cjs');

// Messages as the device's stream server writes them.
// The stream's header: "YMS1", the screen's width and height, then the encoder's name and its length.
function header(width, height, encoder) {
  const name = Buffer.from(encoder, 'utf8'),
    bytes = Buffer.alloc(16 + name.length);
  bytes.write('YMS1', 0, 'latin1');
  bytes.writeInt32BE(width, 4);
  bytes.writeInt32BE(height, 8);
  bytes.writeInt32BE(name.length, 12);
  name.copy(bytes, 16);
  return bytes;
}
// A video frame: type 1, its capture time in microseconds, Android's buffer flags (1 a key frame, 2 the codec
// configuration), and its length and bytes.
function video(pts, flags, data) {
  const bytes = Buffer.alloc(14 + data.length);
  bytes[0] = 1;
  bytes.writeBigInt64BE(BigInt(pts), 1);
  bytes[9] = flags;
  bytes.writeInt32BE(data.length, 10);
  data.copy(bytes, 14);
  return bytes;
}
// The answer to a ping: type 2 and two times, left at zero here. The parser skips it.
function pong() {
  const bytes = Buffer.alloc(17);
  bytes[0] = 2;
  return bytes;
}
// Sound: type 3, the length, then 48 kHz stereo 16-bit PCM.
function sound(pcm) {
  const bytes = Buffer.alloc(5 + pcm.length);
  bytes[0] = 3;
  bytes.writeInt32BE(pcm.length, 1);
  pcm.copy(bytes, 5);
  return bytes;
}
// A new screen size: type 5, then the width and height.
function size(width, height) {
  const bytes = Buffer.alloc(9);
  bytes[0] = 5;
  bytes.writeInt32BE(width, 1);
  bytes.writeInt32BE(height, 5);
  return bytes;
}

const PCM = Buffer.from([0x65, 0x17, 0x65, 0x17, 0x72, 0x19, 0x72, 0x19]); // two stereo frames
// A stream with a message of each kind, and what the parser makes of it (the pong leaves nothing).
const STREAM = Buffer.concat([
  header(1920, 1200, 'c2.mtk.avc.encoder'),
  video(0, 2, Buffer.from([0, 0, 0, 1, 0x67, 0x42])),
  pong(),
  sound(PCM),
  video(16_667, 1, Buffer.from('key frame')),
  size(1200, 1920),
  video(33_333, 0, Buffer.alloc(0)),
]);
const EXPECTED = [
  { type: 'header', width: 1920, height: 1200, encoder: 'c2.mtk.avc.encoder' },
  { type: 'video', pts: 0, flags: 2, data: Buffer.from([0, 0, 0, 1, 0x67, 0x42]) },
  { type: 'sound', data: PCM },
  { type: 'video', pts: 16_667, flags: 1, data: Buffer.from('key frame') },
  { type: 'size', width: 1200, height: 1920 },
  { type: 'video', pts: 33_333, flags: 0, data: Buffer.alloc(0) },
];

test('the stream parses the same whole or a byte at a time', () => {
  const whole = [];
  createParser((message) => whole.push(message))(STREAM);
  assert.deepEqual(whole, EXPECTED);
  const pieces = [],
    parse = createParser((message) => pieces.push(message));
  for (let i = 0; i < STREAM.length; i++) parse(STREAM.subarray(i, i + 1));
  assert.deepEqual(pieces, EXPECTED);
});

test('a frame keeps its bytes after the stream moves on', () => {
  const frames = [],
    parse = createParser((message) => frames.push(message));
  const chunk = Buffer.concat([
    header(8, 8, 'x'),
    video(1, 0, Buffer.from('first')),
    video(2, 0, Buffer.from('second')),
  ]);
  parse(chunk);
  chunk.fill(0);
  assert.deepEqual(
    frames.slice(1).map((frame) => frame.data.toString()),
    ['first', 'second'],
  );
});

test('the device can end the session and say why', () => {
  const messages = [],
    parse = createParser((message) => messages.push(message));
  parse(Buffer.concat([header(8, 8, 'x'), Buffer.from([6])]));
  assert.deepEqual(messages.slice(1), [], 'waits for the reason');
  parse(Buffer.from([1, 6, 9]));
  assert.deepEqual(messages.slice(1), [
    { type: 'ended', reason: 'general' },
    { type: 'ended', reason: 'other' },
  ]);
});

test('anything but our stream is refused', () => {
  assert.throws(
    () => createParser(() => {})(Buffer.from('HTTP/1.1 200 OK\r\n\r\n')),
    /unexpected stream/,
  );
  const long = header(8, 8, 'x');
  long.writeInt32BE(4096, 12);
  assert.throws(() => createParser(() => {})(long), /unexpected stream/);
  const huge = video(0, 0, Buffer.alloc(0));
  huge.writeInt32BE(17 * 1024 * 1024, 10);
  assert.throws(
    () => createParser(() => {})(Buffer.concat([header(8, 8, 'x'), huge])),
    /too large/,
  );
  assert.throws(
    () => createParser(() => {})(Buffer.concat([header(8, 8, 'x'), Buffer.from([9])])),
    /unknown message \(9\)/,
  );
  assert.throws(
    () => createParser(() => {})(Buffer.concat([header(8, 8, 'x'), sound(Buffer.from([1, 2, 3]))])),
    /sound Yes Machine can’t play/,
  );
  const loud = sound(Buffer.alloc(0));
  loud.writeInt32BE(2 * 1024 * 1024, 1);
  assert.throws(
    () => createParser(() => {})(Buffer.concat([header(8, 8, 'x'), loud])),
    /sound Yes Machine can’t play/,
  );
});

test('touches, scrolls, keys, text and the keyboard switch become the bytes the device reads', () => {
  const touch = encodeInput({ type: 'touch', action: 2, x: 0.25, y: 1 });
  assert.deepEqual(
    [touch[0], touch[1], touch.readFloatBE(2), touch.readFloatBE(6), touch.length],
    [4, 2, 0.25, 1, 10],
  );
  const scroll = encodeInput({ type: 'scroll', x: 0.5, y: 0.5, horizontal: -1.5, vertical: 20 });
  assert.deepEqual(
    [
      scroll[0],
      scroll.readFloatBE(1),
      scroll.readFloatBE(5),
      scroll.readFloatBE(9),
      scroll.readFloatBE(13),
      scroll.length,
    ],
    [6, 0.5, 0.5, -1.5, 20, 17],
  );
  const key = encodeInput({ type: 'key', action: 0, code: 66, meta: 0x1001 });
  assert.deepEqual(
    [key[0], key[1], key.readInt32BE(2), key.readInt32BE(6), key.length],
    [7, 0, 66, 0x1001, 10],
  );
  const text = encodeInput({ type: 'text', value: 'ñ' });
  assert.deepEqual([text[0], text.readInt32BE(1), text.subarray(5).toString('utf8')], [8, 2, 'ñ']);
  assert.deepEqual([...encodeInput({ type: 'keyboard', show: true })], [9, 1]);
  assert.deepEqual([...encodeInput({ type: 'keyboard', show: false })], [9, 0]);
});

test('input out of range is dropped instead of reaching the device', () => {
  for (const message of [
    null,
    'touch',
    [],
    { type: 'tap', x: 0, y: 0 },
    { type: 'touch', action: 3, x: 0, y: 0 },
    { type: 'touch', action: 0, x: 1.5, y: 0 },
    { type: 'touch', action: 0, x: NaN, y: 0 },
    { type: 'touch', action: 0, x: '0.5', y: 0 },
    { type: 'touch', action: 0, x: 0.5 },
    { type: 'scroll', x: 0.5, y: 0.5, horizontal: 0, vertical: 21 },
    { type: 'scroll', x: 0.5, y: 0.5, horizontal: Infinity, vertical: 0 },
    { type: 'key', action: 0, code: 0, meta: 0 },
    { type: 'key', action: 0, code: 400, meta: 0 },
    { type: 'key', action: 2, code: 66, meta: 0 },
    { type: 'key', action: 0, code: 66.5, meta: 0 },
    { type: 'key', action: 0, code: 66, meta: -1 },
    { type: 'text', value: '' },
    { type: 'text', value: 'x'.repeat(2001) },
    { type: 'text', value: 7 },
    { type: 'keyboard' },
    { type: 'keyboard', show: 1 },
    { type: 'keyboard', show: 'true' },
  ])
    assert.equal(encodeInput(message), null, JSON.stringify(message));
});

test('the shared clipboard: what the device copied arrives, and text, the report switch and a check go to it', () => {
  const text = 'copiado en la tableta ñ 😀',
    bytes = Buffer.from(text, 'utf8'),
    message = Buffer.alloc(5 + bytes.length);
  message[0] = 7;
  message.writeInt32BE(bytes.length, 1);
  bytes.copy(message, 5);
  const seen = [],
    parse = createParser((each) => seen.push(each));
  for (const byte of Buffer.concat([header(1920, 1200, 'avc'), message]))
    parse(Buffer.from([byte]));
  assert.deepEqual(seen.at(-1), { type: 'clipboard', text });
  const tooMuch = Buffer.alloc(5);
  tooMuch[0] = 7;
  tooMuch.writeInt32BE(CLIPBOARD_LIMIT + 1, 1);
  assert.throws(
    () => createParser(() => {})(Buffer.concat([header(8, 8, 'avc'), tooMuch])),
    /too much copied text/,
  );

  const out = encodeInput({ type: 'clipboard', text: 'from the computer ñ' });
  assert.deepEqual(
    [out[0], out.readInt32BE(1), out.subarray(5).toString('utf8')],
    [10, Buffer.byteLength('from the computer ñ'), 'from the computer ñ'],
  );
  assert.deepEqual([...encodeInput({ type: 'clipboard-report', on: true })], [11, 1]);
  assert.deepEqual([...encodeInput({ type: 'clipboard-report', on: false })], [11, 0]);
  assert.deepEqual([...encodeInput({ type: 'clipboard-check' })], [12]);
  for (const bad of [
    { type: 'clipboard', text: '' },
    { type: 'clipboard', text: 'é'.repeat(30001) },
    { type: 'clipboard', text: 5 },
    { type: 'clipboard-report', on: 1 },
  ])
    assert.equal(encodeInput(bad), null, JSON.stringify(bad).slice(0, 60));
});

test('the file connection: a hello, then open, data, close and result messages, whole or a byte at a time', () => {
  const hello = fileHello('Alejandro’s MacBook Pro', 'macOS 27');
  assert.equal(hello.toString('latin1', 0, 4), 'YMF1');
  assert.deepEqual(JSON.parse(hello.subarray(6, 6 + hello.readUInt16BE(4)).toString('utf8')), {
    name: 'Alejandro’s MacBook Pro',
    system: 'macOS 27',
  });
  const stream = Buffer.concat([
    fileOpen('Informe año.pdf', 5),
    fileData(Buffer.from('hello')),
    fileClose(false),
    fileResult(true, 'Informe año (1).pdf'),
    fileClose(true),
    fileResult(false, 'No room'),
  ]);
  const expected = [
    { type: 'open', size: 5, name: 'Informe año.pdf' },
    { type: 'data', data: Buffer.from('hello') },
    { type: 'close', canceled: false },
    { type: 'result', saved: true, text: 'Informe año (1).pdf' },
    { type: 'close', canceled: true },
    { type: 'result', saved: false, text: 'No room' },
  ];
  const whole = [],
    bytewise = [];
  createFileParser((each) => whole.push(each))(stream);
  const parse = createFileParser((each) => bytewise.push(each));
  for (const byte of stream) parse(Buffer.from([byte]));
  assert.deepEqual(whole, expected);
  assert.deepEqual(bytewise, expected);
  const huge = fileOpen('big', 0);
  huge.writeBigUInt64BE(BigInt(FILE_LIMIT) + 1n, 1);
  assert.throws(() => createFileParser(() => {})(huge), /larger than 10 GB/);
  const chunk = Buffer.alloc(5);
  chunk[0] = 2;
  chunk.writeUInt32BE(4 * FILE_CHUNK + 1, 1);
  assert.throws(() => createFileParser(() => {})(chunk), /too large/);
  assert.throws(() => createFileParser(() => {})(Buffer.from([9])), /unknown file message/);
});
