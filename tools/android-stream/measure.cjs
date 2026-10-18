'use strict';
// Test only. Starts the advanced-mode stream server on an Android device over adb, syncs the two clocks, and reports
// how long frames take from capture on the device to arrival on this computer, with frame rate and bitrate.
// Usage: node measure.cjs [serial=<adb serial>] [seconds=10] [bitrate=8000000] [save=<file.h264>]
// Pass the wireless debugging serial to measure over Wi-Fi. Build the server first with `npm run android-stream`.
// save= writes the raw H.264 stream to a file.
//
// The server's stream (see Server.java in android/stream) is big-endian: a 16-byte header ("YMS1", width, height,
// the length of the encoder's name) and the encoder's name, then messages that start with a type byte. This tool
// reads type 1, video (capture time in microseconds, flags, length, H.264 data), and type 2, pong (the time of the
// ping it answers, then the device's clock in nanoseconds). It keeps type 3 as text in `logs`: the server's first
// version sent its log lines that way, while today's server sends sound with that type. Any other type stops it.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

// The command line's name=value arguments.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]),
);
// adb from ADB, or from where the Android SDK installs it on macOS.
const ADB =
  process.env.ADB || path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb');
const JAR = path.join(__dirname, '../../android/stream/build/yes-machine-stream.jar');
const REMOTE = '/data/local/tmp/yes-machine-stream.jar';
const seconds = Number(args.seconds || 10);
/** Runs adb with these arguments, on the device given by serial= when there is one, and returns its output. */
const adb = (...rest) =>
  execFileSync(ADB, args.serial ? ['-s', args.serial, ...rest] : rest, { encoding: 'utf8' });

// This computer's clock, in nanoseconds.
const now = () => process.hrtime.bigint();
/** A percentile (0 to 100) of the values, to a tenth, or null when there are none. */
const pct = (values, percentile) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? +sorted[Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length))].toFixed(
        1,
      )
    : null;
};

(async () => {
  // --- Start the server and connect to it ---
  // The same command the desktop app uses: the server listens on the local socket yes-machine-stream, and encodes
  // at the bitrate given (bits per second).
  adb('push', JAR, REMOTE);
  const server = spawn(ADB, [
    ...(args.serial ? ['-s', args.serial] : []),
    'shell',
    `CLASSPATH=${REMOTE} app_process / local.yesmachine.stream.Server yes-machine-stream ${Number(args.bitrate || 8000000)}`,
  ]);
  let serverText = '';
  server.stdout.on('data', (chunk) => {
    serverText += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverText += chunk;
  });
  // The server prints "ready" once it listens; wait up to 5 seconds for it.
  for (let i = 0; i < 50 && !serverText.includes('ready'); i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (!serverText.includes('ready')) throw Error(`The server didn't start: ${serverText}`);
  const port = 27183;
  adb('forward', `tcp:${port}`, 'localabstract:yes-machine-stream');
  const socket = net.connect(port, '127.0.0.1');
  socket.setNoDelay(true);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  // --- Read the stream ---
  // offset is the device's clock minus this computer's, in nanoseconds, from the ping with the shortest round trip.
  let buffer = Buffer.alloc(0),
    header = null,
    offset = null,
    bestRtt = Infinity;
  const latencies = [],
    logs = [];
  let frames = 0,
    bytes = 0,
    keyframes = 0,
    started = null;
  const save = args.save ? fs.createWriteStream(args.save) : null;

  /** Sends a ping (type 2) with this computer's time; the server answers with a pong that adds its own clock. */
  function ping() {
    const message = Buffer.alloc(9);
    message.writeUInt8(2, 0);
    message.writeBigInt64BE(now(), 1);
    socket.write(message);
  }
  const pinger = setInterval(ping, 100);

  socket.on('data', (chunk) => {
    const arrived = now();
    buffer = Buffer.concat([buffer, chunk]);
    // Take every complete message off the front of the buffer, and wait for more data when one is incomplete.
    while (true) {
      if (!header) {
        if (buffer.length < 16) return;
        const nameLength = buffer.readInt32BE(12);
        if (buffer.length < 16 + nameLength) return;
        header = {
          magic: buffer.toString('latin1', 0, 4),
          width: buffer.readInt32BE(4),
          height: buffer.readInt32BE(8),
          encoder: buffer.toString('utf8', 16, 16 + nameLength),
        };
        buffer = buffer.subarray(16 + nameLength);
        continue;
      }
      if (buffer.length < 1) return;
      const type = buffer.readUInt8(0);
      if (type === 1) {
        if (buffer.length < 14) return;
        const size = buffer.readInt32BE(10);
        if (buffer.length < 14 + size) return;
        const pts = buffer.readBigInt64BE(1),
          flags = buffer.readUInt8(9);
        if (save) save.write(buffer.subarray(14, 14 + size));
        // Android's encoder flags: 1 is a key frame, 2 the codec configuration, which isn't a frame.
        if (!(flags & 2)) {
          frames++;
          bytes += size;
          if (flags & 1) keyframes++;
          started ??= arrived;
          // The capture time, in nanoseconds on the device's clock, moved to this computer's clock.
          if (offset !== null) latencies.push(Number(arrived - (pts * 1000n - offset)) / 1e6);
        }
        buffer = buffer.subarray(14 + size);
      } else if (type === 2) {
        if (buffer.length < 17) return;
        const sent = buffer.readBigInt64BE(1),
          theirs = buffer.readBigInt64BE(9);
        const rtt = Number(arrived - sent);
        // The ping with the shortest round trip gives the best estimate of the clock difference.
        if (rtt < bestRtt) {
          bestRtt = rtt;
          offset = theirs - (sent + arrived) / 2n;
        }
        buffer = buffer.subarray(17);
      } else if (type === 3) {
        if (buffer.length < 5) return;
        const length = buffer.readInt32BE(1);
        if (buffer.length < 5 + length) return;
        logs.push(buffer.toString('utf8', 5, 5 + length));
        buffer = buffer.subarray(5 + length);
      } else {
        throw Error(`Unknown message type ${type}`);
      }
    }
  });

  // --- Report, and clean up on the device ---
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  clearInterval(pinger);
  // Rates count from the first frame's arrival.
  const elapsed = started ? Number(now() - started) / 1e9 : seconds;
  console.log(
    JSON.stringify(
      {
        header,
        logs,
        clockSyncRttMs: +(bestRtt / 1e6).toFixed(2),
        frames,
        fps: +(frames / elapsed).toFixed(1),
        kbps: Math.round((bytes * 8) / 1000 / elapsed),
        keyframes,
        captureToArrivalMs: {
          n: latencies.length,
          min: pct(latencies, 0),
          p50: pct(latencies, 50),
          p90: pct(latencies, 90),
          max: pct(latencies, 100),
        },
      },
      null,
      1,
    ),
  );
  socket.destroy();
  save?.end();
  server.kill();
  // The server is stopped on the device as well, in case it outlives the local adb process.
  try {
    adb('forward', '--remove', `tcp:${port}`);
  } catch {}
  try {
    adb('shell', 'pkill -f local.yesmachine.stream.Server || true');
  } catch {}
  process.exit(0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
