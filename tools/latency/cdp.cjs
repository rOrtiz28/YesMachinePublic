'use strict';
// Minimal Chrome DevTools Protocol helper for the latency measurements (measure.cjs). Test only.
// launch() starts a headless Google Chrome and connects to its blank page; attach() connects to a page that is
// already open somewhere else, such as the Android app's viewer. Both return the same page object:
//  - send(method, params): sends a DevTools command and resolves with its result.
//  - evaluate(expression): runs JavaScript in the page, waits for it if it is a promise, and returns its value.
//  - shot(file): saves a PNG screenshot of the page.
//  - events: every DevTools event received so far, in order.
//  - close(): disconnects (and, for a launched Chrome, ends it).
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
// YM_CHROME overrides where Chrome is; by default, where macOS installs it.
const CHROME =
  process.env.YM_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Fetches `url` over HTTP and parses the body as JSON. DevTools lists its pages at /json. */
const json = (url) =>
  new Promise((resolve, reject) =>
    http
      .get(url, (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject),
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Starts headless Chrome with DevTools on `port` and a new profile in the `profile` folder (whatever was there is
 * deleted first), with a width × height window and any `extra` command-line flags. Waits up to about five seconds
 * for DevTools to answer, then connects to the blank page and fixes its size at a scale of 1. Closing the returned
 * page ends Chrome.
 */
async function launch({ port = 9333, profile, width = 1280, height = 820, extra = [] }) {
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      // Yes Machine's certificate is self-signed.
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      ...extra,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // Chrome takes a moment to start listening: try every 100 ms, 50 times.
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await json(`http://127.0.0.1:${port}/json`);
      if (targets.length) break;
    } catch {}
    await sleep(100);
  }
  const page = await connect(
    targets.find((target) => target.type === 'page').webSocketDebuggerUrl,
    () => chrome.kill(),
  );
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return page;
}
// Attaches to a page already open where DevTools listens at endpoint (host:port), such as the Android app's viewer
// through adb forward. match picks the page by its address. Closing only lets go of it.
async function attach({ endpoint, match = () => true }) {
  const targets = await json(`http://${endpoint}/json`);
  const page = targets.find((target) => target.type === 'page' && match(target.url));
  if (!page)
    throw Error(
      `No matching page at ${endpoint}: ${targets.map((target) => target.url).join(', ')}`,
    );
  return connect(page.webSocketDebuggerUrl, () => {});
}
/**
 * Connects to a page's DevTools WebSocket at `url` and returns the page object described at the top of this file;
 * `closed` runs when it is closed. Each command carries a new id, and the reply with that id settles its promise;
 * every other message is an event.
 */
async function connect(url, closed) {
  const ws = new WebSocket(url);
  await new Promise((resolve) => ws.once('open', resolve));
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    } else events.push(message);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const commandId = ++id;
      waiting.set(commandId, (reply) =>
        reply.error ? reject(Error(method + ': ' + reply.error.message)) : resolve(reply.result),
      );
      ws.send(JSON.stringify({ id: commandId, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression) => {
    const evaluation = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluation.exceptionDetails)
      throw Error(
        evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text,
      );
    return evaluation.result.value;
  };
  const shot = async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  };
  const close = () => {
    try {
      ws.close();
    } catch {}
    closed();
  };
  return { send, evaluate, shot, close, events };
}
module.exports = { launch, attach, sleep };
