'use strict';

// Tests files between this computer and an Android device it controls (src/main/android/files.cjs), both ways. The
// connection is a pair of real sockets on loopback, and the files are real ones in a temporary folder. The device
// is a stand-in that speaks the file messages of src/main/android/protocol.cjs, the same ones the stream server and
// the Android app use.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createFileChannel } = require('../../src/main/android/files.cjs');
const {
  createFileParser,
  fileOpen,
  fileData,
  fileClose,
  fileResult,
} = require('../../src/main/android/protocol.cjs');

/** A new temporary folder, removed when the test `t` ends. */
function folder(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-files-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// A connected pair of real sockets: the computer's end and a stand-in device's end.
async function pair(t) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const computer = net.connect(server.address().port, '127.0.0.1');
  const device = await accepted;
  t.after(() => {
    computer.destroy();
    device.destroy();
    server.close();
  });
  return { computer, device };
}

// The device's side as the stream server and the app do it: it reads what the computer sends, and answers.
// answer(message, file) runs when a file opens and when it closes. Returns the files received, in order, each with
// its name, size, the data in the parts it came in, and whether the computer canceled it.
function standIn(socket, answer) {
  const received = [];
  let current = null;
  socket.on(
    'data',
    createFileParser((message) => {
      if (message.type === 'open') {
        current = { name: message.name, size: message.size, parts: [] };
        received.push(current);
        answer(message, current);
      } else if (message.type === 'data') current.parts.push(message.data);
      else if (message.type === 'close') {
        current.canceled = message.canceled;
        answer(message, current);
      }
    }),
  );
  return received;
}

// Waits until check() is true, looking every 10 ms for up to 3 seconds; then fails, naming `what` it waited for.
const until = async (check, what) => {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
};

test('files from here go to the device one after another, and each says the name the device saved it as', async (t) => {
  const directory = folder(t),
    { computer, device } = await pair(t);
  const first = path.join(directory, 'Informe año.pdf'),
    second = path.join(directory, 'photo.jpg');
  fs.writeFileSync(first, Buffer.alloc(200_000, 7));
  fs.writeFileSync(second, 'tiny');
  const received = standIn(device, (message, file) => {
    if (message.type === 'close')
      device.write(fileResult(true, file.name === 'photo.jpg' ? 'photo (1).jpg' : file.name));
  });
  const events = [];
  const channel = createFileChannel({
    socket: computer,
    directory: path.join(directory, 'incoming'),
    onEvent: (event) => events.push(event),
  });
  channel.send([
    { path: first, name: 'Informe año.pdf', size: 200_000 },
    { path: second, name: 'photo.jpg', size: 4 },
  ]);
  await until(() => events.filter((event) => event.state === 'sent').length === 2, 'both files');
  assert.deepEqual(
    received.map((file) => [
      file.name,
      file.size,
      Buffer.concat(file.parts).equals(fs.readFileSync(path.join(directory, file.name))),
      file.canceled,
    ]),
    [
      ['Informe año.pdf', 200_000, true, false],
      ['photo.jpg', 4, true, false],
    ],
  );
  assert.deepEqual(
    events
      .filter((event) => event.state === 'sent')
      .map((event) => [event.name, event.detail, event.done]),
    [
      ['Informe año.pdf', 'Informe año.pdf', 200_000],
      ['photo.jpg', 'photo (1).jpg', 4],
    ],
  );
  assert.deepEqual(
    events.filter((event) => event.state === 'waiting').map((event) => event.name),
    ['Informe año.pdf', 'photo.jpg'],
    'both are listed at once',
  );
  assert.equal(channel.busy, false);
});

test('a device without room turns a file down at once, and the rest of it isn’t sent', async (t) => {
  const directory = folder(t),
    { computer, device } = await pair(t);
  const file = path.join(directory, 'movie.mp4');
  fs.writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 1));
  const received = standIn(device, (message) => {
    if (message.type === 'open')
      device.write(fileResult(false, 'The device doesn’t have room for that file.'));
  });
  const events = [];
  createFileChannel({
    socket: computer,
    directory: path.join(directory, 'incoming'),
    onEvent: (event) => events.push(event),
  }).send([{ path: file, name: 'movie.mp4', size: 0 }]);
  await until(
    () => events.some((event) => event.state === 'failed') && received[0]?.canceled !== undefined,
    'the refusal',
  );
  assert.equal(
    events.find((event) => event.state === 'failed').detail,
    'The device doesn’t have room for that file.',
  );
  assert.equal(received[0].canceled, true, 'the computer says it stopped');
  assert.ok(Buffer.concat(received[0].parts).length < 3 * 1024 * 1024, 'not everything was sent');
});

test('a file the device shares arrives privately, is handed over to be saved, and is gone afterwards', async (t) => {
  const directory = folder(t),
    incoming = path.join(directory, 'incoming'),
    { computer, device } = await pair(t);
  const answers = [];
  device.on(
    'data',
    createFileParser((message) => answers.push(message)),
  );
  let handed = null;
  const events = [];
  createFileChannel({
    socket: computer,
    directory: incoming,
    onEvent: (event) => events.push(event),
    onReceived: async (file) => {
      handed = {
        ...file,
        bytes: fs.readFileSync(file.path),
        mode: fs.statSync(file.path).mode & 0o777,
      };
    },
  });
  const content = Buffer.from('a photo from the tablet');
  device.write(
    Buffer.concat([
      fileOpen('IMG_2041.jpg', content.length),
      fileData(content.subarray(0, 5)),
      fileData(content.subarray(5)),
      fileClose(false),
    ]),
  );
  await until(() => handed && fs.readdirSync(incoming).length === 0, 'the hand-over');
  assert.equal(handed.name, 'IMG_2041.jpg');
  assert.ok(handed.bytes.equals(content));
  if (process.platform !== 'win32') assert.equal(handed.mode, 0o600);
  assert.deepEqual(answers, [{ type: 'result', saved: true, text: 'IMG_2041.jpg' }]);
  assert.deepEqual(
    events.map((event) => event.state).filter((state, i, all) => all.indexOf(state) === i),
    ['receiving', 'received'],
  );
});

test('a file the device shares is refused without room here, and an unsafe name is made safe', async (t) => {
  const directory = folder(t),
    incoming = path.join(directory, 'incoming'),
    { computer, device } = await pair(t);
  const answers = [],
    events = [],
    handed = [];
  device.on(
    'data',
    createFileParser((message) => answers.push(message)),
  );
  createFileChannel({
    socket: computer,
    directory: incoming,
    freeSpace: () => 300 * 1024 * 1024,
    onEvent: (event) => events.push(event),
    onReceived: (file) => handed.push(file.name),
  });
  device.write(
    Buffer.concat([
      fileOpen('big.mov', 100 * 1024 * 1024),
      fileData(Buffer.from('ignored')),
      fileClose(false),
    ]),
  );
  device.write(
    Buffer.concat([fileOpen('../../etc/passwd', 2), fileData(Buffer.from('ok')), fileClose(false)]),
  );
  await until(() => answers.length === 2 && handed.length === 1, 'both answers');
  assert.deepEqual(answers[0], {
    type: 'result',
    saved: false,
    text: 'This computer doesn’t have room for that file.',
  });
  assert.deepEqual(handed, ['passwd']);
  assert.equal(events.find((event) => event.state === 'failed').name, 'big.mov');
});

test('a connection that drops ends both ways’ transfers and leaves nothing behind', async (t) => {
  const directory = folder(t),
    incoming = path.join(directory, 'incoming'),
    { computer, device } = await pair(t);
  const file = path.join(directory, 'big.bin');
  fs.writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 2));
  const events = [];
  const channel = createFileChannel({
    socket: computer,
    directory: incoming,
    onEvent: (event) => events.push(event),
  });
  device.write(Buffer.concat([fileOpen('half.jpg', 1000), fileData(Buffer.alloc(10))]));
  await until(() => fs.readdirSync(incoming).length === 1, 'the file to start');
  channel.send([
    { path: file, name: 'big.bin', size: 0 },
    { path: file, name: 'next.bin', size: 0 },
  ]);
  await until(
    () => events.some((event) => event.direction === 'out' && event.state === 'sending'),
    'sending to start',
  );
  device.destroy();
  await until(
    () => events.filter((event) => event.state === 'failed').length === 3,
    'every transfer to fail',
  );
  assert.deepEqual(fs.readdirSync(incoming), []);
  assert.deepEqual(
    events
      .filter((event) => event.state === 'failed')
      .map((event) => event.name)
      .sort(),
    ['big.bin', 'half.jpg', 'next.bin'],
  );
});
