'use strict';
// Test only. A UDP middlebox on the viewer's computer, between the headless viewer and the host, that stands in for
// poor Wi-Fi; measure.cjs starts it with relay=. Every packet in both directions (video, audio, input) gets the same
// treatment: a link speed with a bounded queue, a base delay, random variation without reordering, and random loss.
// Each viewer socket gets its own host-facing socket, like a NAT, so ICE checks and replies stay paired.
const dgram = require('node:dgram');
const { performance } = require('node:perf_hooks');

/**
 * One direction of the impaired link. `delay` and `jitter` are in milliseconds, `loss` is a probability from 0 to 1,
 * and `rate` is the link speed in kilobits per second (0 for no limit). Returns a function that takes a packet's size
 * in bytes and a `deliver` callback, and either drops the packet or calls `deliver` when the packet would arrive.
 * `counters` counts the packets, those lost at random, and those dropped because the queue was full.
 */
function lane({ delay = 0, jitter = 0, loss = 0, rate = 0 }, counters) {
  // When the link finishes sending the last packet it accepted, and when that packet arrives.
  let lastOut = 0,
    lastDeliver = 0;
  return (size, deliver) => {
    counters.packets++;
    if (Math.random() < loss) {
      counters.lost++;
      return;
    }
    const now = performance.now();
    // The time the packet takes to go out at the link speed (bits divided by bits per millisecond), after the
    // packets queued before it. A packet that would wait more than 300 ms is dropped, as a full queue does.
    const serialize = rate ? (size * 8) / rate : 0;
    const start = Math.max(now, lastOut);
    if (start + serialize - now > 300) {
      counters.queueDrops++;
      return;
    }
    lastOut = start + serialize;
    // Then the base delay, plus or minus up to `jitter`, but never before the previous packet arrives.
    const at = Math.max(lastOut + delay + (Math.random() * 2 - 1) * jitter, lastDeliver);
    lastDeliver = at;
    setTimeout(deliver, Math.max(0, at - now));
  };
}

/**
 * Starts the relay on the `bind` address and returns:
 *  - port: where the viewer sends its packets.
 *  - setHostPort(port): where the relay sends them on, at `hostAddress`. Until it is set, packets are dropped.
 *  - counters: the `lane` counters for each direction, `up` (to the host) and `down` (to the viewer).
 *  - close(): closes every socket; packets still on their way are dropped.
 * `impair` holds the link's settings, the same for both directions (see lane).
 */
async function startRelay({ bind, hostAddress, impair }) {
  const counters = {
    up: { packets: 0, lost: 0, queueDrops: 0 },
    down: { packets: 0, lost: 0, queueDrops: 0 },
  };
  const up = lane(impair, counters.up),
    down = lane(impair, counters.down);
  const front = dgram.createSocket('udp4');
  // The host-facing socket for each viewer socket, by its address and port.
  const flows = new Map();
  let hostPort = null,
    closed = false;
  // A delayed send must not run after close(), and a failed send only loses that packet.
  const safe = (fn) => () => {
    if (!closed)
      try {
        fn();
      } catch {}
  };
  await new Promise((resolve) => front.bind(0, bind, resolve));
  front.on('message', (packet, from) => {
    if (!hostPort) return;
    const key = `${from.address}:${from.port}`;
    let back = flows.get(key);
    if (!back) {
      back = dgram.createSocket('udp4');
      back.bind(0, bind);
      back.on('message', (reply) =>
        down(
          reply.length,
          safe(() => front.send(reply, from.port, from.address)),
        ),
      );
      flows.set(key, back);
    }
    up(
      packet.length,
      safe(() => back.send(packet, hostPort, hostAddress)),
    );
  });
  return {
    port: front.address().port,
    setHostPort(port) {
      hostPort = port;
    },
    counters,
    close() {
      closed = true;
      front.close();
      for (const socket of flows.values()) socket.close();
    },
  };
}
module.exports = { startRelay };
