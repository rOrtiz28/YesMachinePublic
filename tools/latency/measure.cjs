'use strict';
// Test only. Measures how quickly the remote desktop answers the pointer, and what WebRTC reports on both ends. It
// signs in to the latency harness (harness/main.cjs) on another computer from headless Chrome on this one, or, with
// YM_CDP, attaches to a viewer that is already connected, such as the Android app's. Then it measures:
//  - round trip: pointer move in the viewer -> host window changes color -> that change shows in the video
//  - delivered frame rate and pacing, bitrate, resolution, codec, decode and jitter-buffer time
//  - the host's encoder, capture rate and what limits quality
// Each run prints its result as JSON and appends it to results.jsonl in YM_OUT (a temporary folder by default).
// tools/latency/README.md explains how to set up both computers.
// Usage: node measure.cjs label=name [rounds=40] [relay=delay:15,jitter:25,loss:2,rate:8000] [pattern=<PATTERN json>]
// More options: warm=<ms> (how long the video runs before measuring, 8000 by default), mode=frames (record the
// timing of every frame for 8 seconds instead), debug=1 (print the connection's progress for 10 seconds instead),
// hostEval=<JavaScript> (run code in the harness's host page before the viewer connects).
// Environment: YM_HOST (harness computer's address), YM_USER (its account), YM_TOKEN (path to a copy of its
// harness/token), YM_BIND (this computer's address, for relay=), YM_SSH (optional "-i key user@host" for the
// host's own statistics through an SSH tunnel to its port 9224), YM_WINDOWS=1 when the harness runs on Windows.
// With YM_CDP=host:port, where DevTools for an open viewer listens (for the Android app, through adb forward to its
// webview_devtools_remote socket), none of the others are needed, and pattern= gives the window's place.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { launch, attach, sleep } = require('./cdp.cjs');
const { startRelay } = require('./relay.cjs');

// --- Options ---

// The command line's name=value arguments.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]),
);
const label = args.label || 'run';
const rounds = Number(args.rounds || 40);
// The value of an environment variable this run can't do without.
const need = (name) =>
  process.env[name] ||
  (() => {
    throw Error(`Set ${name}; see tools/latency/README.md`);
  })();
const ATTACH = process.env.YM_CDP;
// The harness listens on port 4778.
const HOST = ATTACH ? null : `https://${need('YM_HOST')}:4778/`;
const token = ATTACH ? null : fs.readFileSync(need('YM_TOKEN'), 'utf8').trim();
/**
 * Where the color window sits on the host's screen, as { window, display } bounds in the screen's points:
 * pattern=<the JSON after PATTERN in the harness log>, or read from that log over YM_SSH (on Windows the log is
 * %TEMP%\ym-latency.log). The last PATTERN line wins.
 */
function patternGeometry() {
  if (args.pattern) return JSON.parse(args.pattern);
  if (!process.env.YM_SSH)
    throw Error('Pass pattern=<PATTERN json from the harness log> or set YM_SSH');
  const read =
    process.env.YM_WINDOWS === '1'
      ? 'findstr PATTERN "%TEMP%\\ym-latency.log"'
      : 'grep PATTERN /tmp/ym-latency.log | tail -1';
  // BatchMode makes ssh fail instead of asking for a password.
  const lines = require('node:child_process')
    .execFileSync('ssh', ['-o', 'BatchMode=yes', ...process.env.YM_SSH.split(' '), read], {
      encoding: 'utf8',
    })
    .trim()
    .split(/\r?\n/);
  const line = lines.at(-1);
  return JSON.parse(line.slice(line.indexOf('{')));
}
const geometry = patternGeometry();
const OUT = process.env.YM_OUT || path.join(require('node:os').tmpdir(), 'ym-latency');
fs.mkdirSync(OUT, { recursive: true });

// --- Code that runs in the viewer page ---

// Runs in the viewer page before the page's own scripts. It wraps RTCPeerConnection so the page's connections can be
// inspected (window.__pcs). With relay=, it also points the session at the relay. The host's first UDP candidate is
// rewritten to the relay's address and port, and its real port is kept in window.__hostPort for the relay to send
// to; the host's other candidates, and those inside its offer, are dropped. This page's own candidates are withheld
// from the host, both those sent on their own and those inside its answer, so the host only ever hears this page
// through the relay.
const WRAPPER = `(() => {
  const Native = window.RTCPeerConnection; if (!Native) return; window.__pcs = [];
  window.RTCPeerConnection = new Proxy(Native, { construct(target, a) {
    const pc = new target(...a); window.__pcs.push(pc);
    return pc; } });
  if (window.__relayPort) {
    const strip = sdp => sdp.split('\\r\\n').filter(l => !l.startsWith('a=candidate')).join('\\r\\n');
    const setRemote = Native.prototype.setRemoteDescription;
    Native.prototype.setRemoteDescription = function (d) { return setRemote.call(this, d && d.sdp ? { type: d.type, sdp: strip(d.sdp) } : d); };
    const addIce = Native.prototype.addIceCandidate;
    Native.prototype.addIceCandidate = function (c) {
      if (!c || !c.candidate) return addIce.call(this, c);
      const f = c.candidate.split(' ');
      if (f[2].toLowerCase() !== 'udp' || window.__hostPort) return Promise.resolve();
      window.__hostPort = Number(f[5]); f[4] = window.__relayAddress; f[5] = String(window.__relayPort);
      return addIce.call(this, { candidate: f.join(' '), sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
    };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { const m = JSON.parse(data);
        if (m.type === 'ice' && m.candidate) return;
        if (m.type === 'answer' && m.sdp) { m.sdp.sdp = strip(m.sdp.sdp); data = JSON.stringify(m); }
      } catch {}
      return send.call(this, data);
    };
  }
})();`;

// Helpers installed in the connected viewer page, which the measurements below call with evaluate():
//  - __stats(): the latest connection's statistics: the incoming video, the candidate pair in use, and codec names.
//  - __probe({ left, right, sample, rounds }): moves the pointer to `right` and `left` in turn and, after each move,
//    waits for the video at `sample` to turn white or black, returning when each change was received and when it
//    was shown, relative to the move (null for a change that never came). Positions are fractions of the video frame.
//  - __cadence(ms): the times at which video frames were presented during `ms` milliseconds.
const PAGE_TOOLS = `(() => {
  window.__stats = async () => {
    const pc = window.__pcs.at(-1), report = await pc.getStats(), out = { codecs: {} };
    report.forEach(s => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') out.video = s;
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) out.pair = s;
      if (s.type === 'codec') out.codecs[s.id] = s.mimeType;
    });
    out.hasJbt = 'jitterBufferTarget' in RTCRtpReceiver.prototype;
    return JSON.parse(JSON.stringify(out));
  };
  const video = document.getElementById('remote-video');
  const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const client = (nx, ny) => {
    const b = video.getBoundingClientRect(), s = Math.min(b.width / video.videoWidth, b.height / video.videoHeight);
    const w = video.videoWidth * s, h = video.videoHeight * s;
    return { x: b.left + (b.width - w) / 2 + nx * w, y: b.top + (b.height - h) / 2 + ny * h };
  };
  const level = (p) => {
    ctx.drawImage(video, p.x * video.videoWidth - 4, p.y * video.videoHeight - 4, 8, 8, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3;
  };
  const move = (p) => { const c = client(p.x, p.y);
    video.dispatchEvent(new PointerEvent('pointermove', { clientX: c.x, clientY: c.y, pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true })); };
  const waitFor = (sample, white, since, timeout) => new Promise(resolve => {
    const check = (now, meta) => {
      const value = level(sample);
      if (white ? value > 170 : value < 85) resolve({ display: meta.expectedDisplayTime, now, received: meta.receiveTime, captured: meta.captureTime, decode: meta.processingDuration, frames: meta.presentedFrames });
      else if (now - since > timeout) resolve(null);
      else video.requestVideoFrameCallback(check);
    };
    video.requestVideoFrameCallback(check);
  });
  window.__probe = async ({ left, right, sample, rounds }) => {
    move(left); await waitFor(sample, false, performance.now(), 5000);
    await new Promise(r => setTimeout(r, 400));
    const samples = [];
    for (let i = 0; i < rounds; i++) {
      const white = i % 2 === 0, t0 = performance.now();
      move(white ? right : left);
      const hit = await waitFor(sample, white, t0, 3000);
      samples.push(hit ? { total: hit.display - t0, shown: hit.now - t0, received: hit.received ? hit.received - t0 : null, decode: hit.decode } : null);
      await new Promise(r => setTimeout(r, 120 + Math.random() * 160));
    }
    return samples;
  };
  // Presented frame cadence over a window of time: rate, spread of intervals, and long gaps.
  window.__cadence = (ms) => new Promise(resolve => {
    const times = []; const start = performance.now();
    const tick = (now) => { times.push(now); if (now - start < ms) video.requestVideoFrameCallback(tick); else resolve(times); };
    video.requestVideoFrameCallback(tick);
  });
})();`;

// --- The host's side, through the harness's DevTools port ---

/**
 * Runs `expression` in the harness's main window (host.html) through its DevTools port, 9224, which the YM_SSH
 * tunnel brings to this computer. Resolves with the expression's value, the description of the exception it
 * threw, or { error } when the host can't be reached; it never rejects.
 */
function hostEval(expression) {
  return new Promise((resolve) => {
    http
      .get('http://127.0.0.1:9224/json', (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => {
          try {
            const page = JSON.parse(text).find((target) => target.url.endsWith('host.html'));
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            ws.on('open', () =>
              ws.send(
                JSON.stringify({
                  id: 1,
                  method: 'Runtime.evaluate',
                  params: { awaitPromise: true, returnByValue: true, expression },
                }),
              ),
            );
            ws.on('message', (message) => {
              const reply = JSON.parse(message);
              ws.close();
              resolve(
                reply.result?.result?.value ??
                  reply.result?.exceptionDetails?.exception?.description ??
                  null,
              );
            });
            ws.on('error', (error) => resolve({ error: error.message }));
          } catch (error) {
            resolve({ error: error.message });
          }
        });
      })
      .on('error', (error) => resolve({ error: error.message }));
  });
}

/**
 * The host's own statistics, read the same way from its main window, where `peer` is the connection and `media` the
 * captured screen: the outgoing video, the captured video source, codec names, and the captured track's settings
 * and content hint. Resolves with { error } when they can't be read.
 */
function hostStats() {
  return new Promise((resolve) => {
    http
      .get('http://127.0.0.1:9224/json', (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => {
          try {
            const page = JSON.parse(text).find((target) => target.url.endsWith('host.html'));
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            ws.on('open', () =>
              ws.send(
                JSON.stringify({
                  id: 1,
                  method: 'Runtime.evaluate',
                  params: {
                    awaitPromise: true,
                    returnByValue: true,
                    expression: `(async () => {
            const report = await peer.getStats(), out = { codecs: {} };
            report.forEach(s => { if (s.type === 'outbound-rtp' && s.kind === 'video') out.video = s; if (s.type === 'media-source' && s.kind === 'video') out.source = s; if (s.type === 'codec') out.codecs[s.id] = s.mimeType; });
            out.settings = media.getVideoTracks()[0].getSettings(); out.hint = media.getVideoTracks()[0].contentHint;
            return JSON.parse(JSON.stringify(out)); })()`,
                  },
                }),
              ),
            );
            ws.on('message', (message) => {
              const reply = JSON.parse(message);
              ws.close();
              resolve(reply.result?.result?.value || { error: reply });
            });
            ws.on('error', (error) => resolve({ error: error.message }));
          } catch (error) {
            resolve({ error: error.message });
          }
        });
      })
      .on('error', (error) => resolve({ error: error.message }));
  });
}

// --- Finding an open viewer's connection, and summing up ---

/**
 * An open viewer's peer connection lives inside its page's code; DevTools finds it among the page's objects, so the
 * statistics work without the wrapper, which only a page about to load can get. Keeps the connected ones in
 * window.__pcs (or every one, when none is connected) and returns how many there are.
 */
async function findPeers(browser) {
  const { result } = await browser.send('Runtime.evaluate', {
    expression: 'RTCPeerConnection.prototype',
  });
  const { objects } = await browser.send('Runtime.queryObjects', {
    prototypeObjectId: result.objectId,
  });
  const found = await browser.send('Runtime.callFunctionOn', {
    objectId: objects.objectId,
    returnByValue: true,
    functionDeclaration:
      'function () { const all = Array.from(this); window.__pcs = all.filter(pc => pc.connectionState === "connected"); if (!window.__pcs.length) window.__pcs = all; return window.__pcs.length; }',
  });
  return found.result.value;
}

/** A percentile (0 to 100) of the values that aren't null or undefined, rounded, or null when there are none. */
const pct = (values, percentile) => {
  const sorted = values.filter((value) => value != null).sort((a, b) => a - b);
  return sorted.length
    ? Math.round(
        sorted[Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length))],
      )
    : null;
};
/** How many values there are (leaving out missing ones), and their minimum, median, 90th percentile and maximum. */
const summary = (values) => ({
  n: values.filter((value) => value != null).length,
  min: pct(values, 0),
  p50: pct(values, 50),
  p90: pct(values, 90),
  max: pct(values, 100),
});

// --- The run ---

(async () => {
  // With YM_SSH, this computer's port 9224 leads to the harness's DevTools port, for hostEval and hostStats.
  const tunnel = process.env.YM_SSH
    ? spawn(
        'ssh',
        [
          '-o',
          'ExitOnForwardFailure=yes',
          '-o',
          'BatchMode=yes',
          '-N',
          '-L',
          '9224:127.0.0.1:9224',
          ...process.env.YM_SSH.split(' '),
        ],
        { stdio: 'ignore' },
      )
    : null;
  let relay = null;
  if (args.relay) {
    // relay=delay:15,jitter:25,loss:2,rate:8000: delay and jitter in milliseconds, loss in percent (the relay takes
    // a fraction) and the link speed in kilobits per second.
    const impair = Object.fromEntries(
      args.relay
        .split(',')
        .map((pair) => pair.split(':'))
        .map(([key, value]) => [key, Number(value)]),
    );
    if (impair.loss) impair.loss /= 100;
    relay = await startRelay({ bind: need('YM_BIND'), hostAddress: need('YM_HOST'), impair });
  }
  // Chrome's own network emulation field trials had no effect on WebRTC here; the relay is what degrades the link.
  const extra = ['--autoplay-policy=no-user-gesture-required'];
  // Give the tunnel time to connect.
  await sleep(1500);
  if (args.hostEval) console.error('host setup:', JSON.stringify(await hostEval(args.hostEval)));
  // Attached, the viewer is any page but the Android app's home page. Otherwise, a new headless Chrome.
  const browser = ATTACH
    ? await attach({ endpoint: ATTACH, match: (url) => !url.endsWith('/home.html') })
    : await launch({
        port: 9340,
        profile: path.join(OUT, `profile-${label}`),
        width: 1440,
        height: 900,
        extra,
      });
  try {
    // --- Connect ---
    if (ATTACH) {
      if (
        !(await browser.evaluate(
          `(() => { const v = document.getElementById('remote-video'); return !!v && v.readyState >= 2 && v.videoWidth > 0; })()`,
        ))
      )
        throw Error('The viewer shows no desktop yet.');
      console.error('peer connections found:', await findPeers(browser));
    } else {
      // The wrapper (with the relay's address) goes in before the viewer's own scripts run; then sign in.
      await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source:
          (relay
            ? `window.__relayPort = ${relay.port}; window.__relayAddress = '${need('YM_BIND')}';`
            : '') + WRAPPER,
      });
      await browser.send('Page.navigate', { url: HOST });
      await sleep(1500);
      await browser.evaluate(
        `(() => { document.getElementById('sign-in-user').value = ${JSON.stringify(need('YM_USER'))}; document.getElementById('sign-in-password').value = ${JSON.stringify(token)}; document.getElementById('connect-button').click(); return true; })()`,
      );
      // Wait up to 20 seconds for the session's video. Meanwhile, the relay learns the host's port as soon as the
      // page has it.
      for (let i = 0; i < 100; i++) {
        await sleep(200);
        if (relay) {
          const port = await browser.evaluate('window.__hostPort || 0');
          if (port) relay.setHostPort(port);
        }
        if (
          await browser.evaluate(
            `(() => { const v = document.getElementById('remote-video'); return !document.getElementById('session').hidden && v.readyState >= 2 && v.videoWidth > 0; })()`,
          )
        )
          break;
      }
      // debug=1: print how the connection is doing every second for 10 seconds, and measure nothing.
      if (args.debug) {
        for (let i = 0; i < 10; i++) {
          await sleep(1000);
          console.error(
            JSON.stringify({
              t: i,
              hostPort: await browser.evaluate('window.__hostPort || null'),
              relay: relay?.counters,
              state: await browser.evaluate(
                `(() => { const pc = (window.__pcs || []).at(-1); return pc ? [pc.connectionState, pc.iceConnectionState, pc.iceGatheringState] : null; })()`,
              ),
              notice: await browser.evaluate(
                `document.getElementById('notice').hidden ? '' : document.getElementById('notice-text').textContent`,
              ),
              detail: await browser.evaluate(
                `document.getElementById('connection-detail').textContent`,
              ),
            }),
          );
        }
        return;
      }
    }
    // --- Measure ---
    await browser.evaluate(PAGE_TOOLS);
    // Let the video settle before measuring.
    const warm = Number(args.warm || 8000);
    await sleep(warm);
    const before = await browser.evaluate('window.__stats()');
    // The video shows the host's whole display, so a point on its screen, as a fraction of the display, is the same
    // fraction of the video frame.
    const toFraction = (x, y) => ({
      x: (x - geometry.display.x) / geometry.display.width,
      y: (y - geometry.display.y) / geometry.display.height,
    });
    // The pointer moves between the left and right halves of the color window; the color is read near its bottom.
    const box = geometry.window;
    const probe = {
      left: toFraction(box.x + box.width * 0.25, box.y + box.height * 0.3),
      right: toFraction(box.x + box.width * 0.75, box.y + box.height * 0.3),
      sample: toFraction(box.x + box.width * 0.5, box.y + box.height * 0.8),
      rounds,
    };
    // mode=frames: record every frame for 8 seconds instead, saved to frames-<label>.json, and summarize how late
    // each one arrived compared with its RTP timestamp, how long it was held before display, and the gaps between
    // arrivals.
    if (args.mode === 'frames') {
      const frames =
        await browser.evaluate(`new Promise(resolve => { const v = document.getElementById('remote-video'), out = [], start = performance.now();
        const flip = setInterval(() => window.__flip = !window.__flip, 250);
        const tick = (now, m) => { out.push({ now, shown: m.expectedDisplayTime, recv: m.receiveTime, rtp: m.rtpTimestamp, cap: m.captureTime, n: m.presentedFrames });
          if (now - start < 8000) v.requestVideoFrameCallback(tick); else { clearInterval(flip); resolve(out); } };
        v.requestVideoFrameCallback(tick); })`);
      fs.writeFileSync(path.join(OUT, `frames-${label}.json`), JSON.stringify(frames));
      const timed = frames.filter((frame) => frame.recv != null && frame.rtp != null);
      const base = timed[0];
      // How much later than the first frame each one arrived, minus how much later it was sent by its RTP
      // timestamp (video's RTP clock runs at 90 kHz, so dividing by 90 gives milliseconds). The smallest delay is 0.
      const delays = timed.map((frame) => frame.recv - base.recv - (frame.rtp - base.rtp) / 90);
      const lowest = Math.min(...delays);
      const relative = delays.map((delay) => Math.round(delay - lowest));
      const buffered = timed.map((frame) => Math.round(frame.shown - frame.recv));
      const gaps = timed.slice(1).map((frame, i) => Math.round(frame.recv - timed[i].recv));
      // The minimum, median, 90th percentile and maximum of some numbers.
      const pick = (values) => {
        const sorted = [...values].sort((x, y) => x - y);
        return {
          min: sorted[0],
          p50: sorted[Math.floor(sorted.length / 2)],
          p90: sorted[Math.floor(sorted.length * 0.9)],
          max: sorted.at(-1),
        };
      };
      console.log(
        JSON.stringify(
          {
            frames: timed.length,
            captureTimeAvailable: timed.some((frame) => frame.cap != null),
            arrivalDelayVsRtpMs: pick(relative),
            heldBeforeDisplayMs: pick(buffered),
            arrivalGapsMs: pick(gaps),
            firstDelays: relative.slice(0, 40),
          },
          null,
          1,
        ),
      );
      return;
    }
    // The round trips, then 4 seconds of frame cadence, with the statistics before and after them.
    const started = Date.now();
    const samples = await browser.evaluate(`window.__probe(${JSON.stringify(probe)})`);
    const cadence = await browser.evaluate(`window.__cadence(4000)`);
    const after = await browser.evaluate('window.__stats()');
    const seconds = (Date.now() - started) / 1000;
    const host = await hostStats();
    // The viewer's counters only grow, so its figures for this run are the differences between the statistics
    // after it and before it, per frame where that applies.
    const videoBefore = before.video || {},
      videoAfter = after.video || {};
    const intervals = cadence.slice(1).map((time, i) => time - cadence[i]);
    const mean = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
    const hostVideo = host.video || {};
    const result = {
      label,
      net: args.relay || 'none',
      relay: relay ? relay.counters : null,
      roundTripMs: summary(samples.map((sample) => sample && sample.total)),
      untilReceivedMs: summary(samples.map((sample) => sample && sample.received)),
      missed: samples.filter((sample) => !sample).length,
      viewer: {
        codec: after.codecs[videoAfter.codecId],
        size: `${videoAfter.frameWidth}x${videoAfter.frameHeight}`,
        fps: videoAfter.framesPerSecond,
        kbps: Math.round(
          ((videoAfter.bytesReceived - videoBefore.bytesReceived) * 8) / 1000 / seconds,
        ),
        jitterBufferMs: videoAfter.jitterBufferEmittedCount
          ? Math.round(
              ((videoAfter.jitterBufferDelay - (videoBefore.jitterBufferDelay || 0)) /
                Math.max(
                  1,
                  videoAfter.jitterBufferEmittedCount - (videoBefore.jitterBufferEmittedCount || 0),
                )) *
                1000,
            )
          : null,
        decodeMs: videoAfter.framesDecoded
          ? +(
              ((videoAfter.totalDecodeTime - (videoBefore.totalDecodeTime || 0)) /
                Math.max(1, videoAfter.framesDecoded - (videoBefore.framesDecoded || 0))) *
              1000
            ).toFixed(1)
          : null,
        qp:
          videoAfter.qpSum && videoAfter.framesDecoded
            ? +(
                (videoAfter.qpSum - (videoBefore.qpSum || 0)) /
                Math.max(1, videoAfter.framesDecoded - (videoBefore.framesDecoded || 0))
              ).toFixed(1)
            : null,
        lost: (videoAfter.packetsLost || 0) - (videoBefore.packetsLost || 0),
        nacks: (videoAfter.nackCount || 0) - (videoBefore.nackCount || 0),
        plis: (videoAfter.pliCount || 0) - (videoBefore.pliCount || 0),
        freezes: (videoAfter.freezeCount || 0) - (videoBefore.freezeCount || 0),
        dropped: (videoAfter.framesDropped || 0) - (videoBefore.framesDropped || 0),
        targetMs: videoAfter.jitterBufferEmittedCount
          ? Math.round(
              (((videoAfter.jitterBufferTargetDelay || 0) -
                (videoBefore.jitterBufferTargetDelay || 0)) /
                Math.max(
                  1,
                  videoAfter.jitterBufferEmittedCount - (videoBefore.jitterBufferEmittedCount || 0),
                )) *
                1000,
            )
          : null,
        minimumMs: videoAfter.jitterBufferEmittedCount
          ? Math.round(
              (((videoAfter.jitterBufferMinimumDelay || 0) -
                (videoBefore.jitterBufferMinimumDelay || 0)) /
                Math.max(
                  1,
                  videoAfter.jitterBufferEmittedCount - (videoBefore.jitterBufferEmittedCount || 0),
                )) *
                1000,
            )
          : null,
        contentType: videoAfter.contentType,
        hasJitterBufferTarget: after.hasJbt,
        rttMs: after.pair ? Math.round(after.pair.currentRoundTripTime * 1000) : null,
        cadence: {
          fps: +(1000 / mean).toFixed(1),
          worstGapMs: Math.round(Math.max(...intervals)),
          gapsOver50ms: intervals.filter((interval) => interval > 50).length,
        },
      },
      host: host.error
        ? host
        : {
            encoder: hostVideo.encoderImplementation,
            powerEfficient: hostVideo.powerEfficientEncoder,
            codec: host.codecs?.[hostVideo.codecId],
            size: `${hostVideo.frameWidth}x${hostVideo.frameHeight}`,
            fps: hostVideo.framesPerSecond,
            captureFps: host.source?.framesPerSecond,
            captureSize: `${host.source?.width}x${host.source?.height}`,
            encodeMs: hostVideo.framesEncoded
              ? +((hostVideo.totalEncodeTime / hostVideo.framesEncoded) * 1000).toFixed(1)
              : null,
            targetKbps: hostVideo.targetBitrate ? Math.round(hostVideo.targetBitrate / 1000) : null,
            limitedBy: hostVideo.qualityLimitationReason,
            limitedSeconds: hostVideo.qualityLimitationDurations,
            contentHint: host.hint,
            settings: host.settings,
          },
    };
    console.log(JSON.stringify(result, null, 1));
    fs.appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify(result) + '\n');
  } finally {
    browser.close();
    tunnel?.kill();
    relay?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
