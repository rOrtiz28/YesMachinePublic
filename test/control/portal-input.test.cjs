'use strict';

// Tests remote control in a Wayland session through the desktop's RemoteDesktop portal
// (src/main/control/portal-input.cjs). The Python helper that holds the portal session is a stand-in, a fake child
// process the tests answer for, so no portal or desktop is needed; the saved approval is a real file in a temporary
// folder. Two tests run python3 when it is installed: one checks that the real helper compiles, and one runs the
// helper's clipboard functions against stand-in portal signals.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { createPortalInput, keysym, HELPER } = require('../../src/main/control/portal-input.cjs');

// A stand-in for the Python helper: records what it is sent and lets the test answer for it. `sent` holds each line
// written to its stdin, `calls` each start with its command and arguments, and reply(message) writes a JSON line to
// its stdout, as the helper does.
function fakeHelper() {
  const sent = [];
  let pending = '';
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        sent.push(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      done();
    },
  });
  child.kill = () => child.emit('exit', null);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    return child;
  };
  const reply = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  return { child, run, calls, sent, reply };
}

/** A new temporary folder, removed when the test `t` ends. */
function folder(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-portal-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// The helper's message once the portal session has started: the shared screen's stream and a new restore token.
const READY = {
  type: 'ready',
  stream: { node: 42, x: 0, y: 0, width: 1920, height: 1200 },
  token: 'restore-1',
};

test('X keysyms cover the keys input.cjs sends', () => {
  assert.equal(keysym('a'), 0x61);
  assert.equal(keysym('7'), 0x37);
  assert.equal(keysym('/'), 0x2f);
  assert.equal(keysym('enter'), 0xff0d);
  assert.equal(keysym('command'), 0xffeb);
  assert.equal(keysym('left_control'), 0xffe3);
  assert.equal(keysym('f1'), 0xffbe);
  assert.equal(keysym('f24'), 0xffd5);
  for (const unknown of ['A', 'f25', 'numpad_1', '', null, 'menu'])
    assert.equal(keysym(unknown), null, String(unknown));
});

test('the saved approval goes to the helper on stdin, never in its arguments, and a new one is kept privately', async (t) => {
  const directory = folder(t);
  const tokenFile = path.join(directory, 'wayland-remote-control.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ token: 'restore-0', clipboardAsked: true }));
  const helper = fakeHelper();
  const states = [];
  const portal = createPortalInput({
    tokenFile,
    bounds: { x: 0, y: 0, width: 1920, height: 1200 },
    run: helper.run,
    onState: (state) => states.push(state),
  });
  const started = portal.start();
  assert.equal(portal.state, 'asking');
  assert.deepEqual(
    helper.calls.map(([command, args]) => [command, args.slice(0, 2)]),
    [['python3', ['-I', '-c']]],
  );
  assert.ok(!helper.calls[0][1].some((argument) => argument.includes('restore-0')));
  helper.reply(READY);
  assert.equal(await started, 'allowed');
  assert.equal(helper.sent[0], 'restore-0');
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenFile, 'utf8')), {
    token: 'restore-1',
    clipboardAsked: true,
  });
  if (process.platform !== 'win32') assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  assert.deepEqual(states, ['asking', 'allowed']);
});

test("input becomes portal commands in the shared screen's coordinates", async (t) => {
  const helper = fakeHelper();
  const portal = createPortalInput({
    tokenFile: path.join(folder(t), 'token.json'),
    bounds: () => ({ x: 0, y: 0, width: 960, height: 600 }),
    run: helper.run,
  });
  const started = portal.start();
  helper.reply(READY);
  await started;
  const { robot } = portal;
  robot.moveMouse(959, 599);
  robot.moveMouse(0, 0);
  robot.mouseToggle('down', 'right');
  robot.mouseToggle('up', 'right');
  robot.mouseClick('left', true);
  robot.scrollMouse(0, -3);
  robot.scrollMouse(2, 0);
  robot.keyToggle('shift', 'down');
  robot.keyToggle('shift', 'up');
  robot.typeString('Hi\n');
  // Buttons go by their evdev codes (0x110 left, 0x111 right) and keys by their X keysyms. The scroll steps change
  // sign, a double click is two clicks, and each typed character is a press and a release.
  const commands = helper.sent.slice(1).map((line) => JSON.parse(line));
  assert.deepEqual(commands, [
    { m: [1919, 1199] },
    { m: [0, 0] },
    { b: 0x111, d: 1 },
    { b: 0x111, d: 0 },
    { b: 0x110, d: 1 },
    { b: 0x110, d: 0 },
    { b: 0x110, d: 1 },
    { b: 0x110, d: 0 },
    { a: 0, s: 3 },
    { a: 1, s: -2 },
    { k: 0xffe1, d: 1 },
    { k: 0xffe1, d: 0 },
    { k: 0x48, d: 1 },
    { k: 0x48, d: 0 },
    { k: 0x69, d: 1 },
    { k: 0x69, d: 0 },
    { k: 0xff0d, d: 1 },
    { k: 0xff0d, d: 0 },
  ]);
  assert.throws(() => robot.keyToggle('numpad_lock', 'down'), { code: 'UNSUPPORTED_KEY' });
  portal.stop();
  assert.equal(portal.state, 'off');
  assert.throws(() => robot.moveMouse(1, 1), { code: 'INPUT_UNAVAILABLE' });
});

test('a declined dialog or a missing portal leaves remote control off and sends nothing', async (t) => {
  const tokenFile = path.join(folder(t), 'token.json');
  const declined = fakeHelper();
  const portal = createPortalInput({
    tokenFile,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    run: declined.run,
  });
  const first = portal.start();
  declined.reply({ type: 'error', reason: 'denied' });
  assert.equal(await first, 'denied');
  assert.throws(() => portal.robot.mouseToggle('down', 'left'), { code: 'INPUT_UNAVAILABLE' });
  assert.equal(declined.sent.length, 1, 'only the empty restore line');
  assert.equal(declined.sent[0], '');
  declined.child.emit('exit', 1);
  assert.ok(!fs.existsSync(tokenFile));

  const missing = createPortalInput({
    tokenFile,
    run: () => {
      throw Object.assign(new Error('spawn python3 ENOENT'), { code: 'ENOENT' });
    },
  });
  assert.equal(await missing.start(), 'unavailable');

  const failing = fakeHelper();
  const again = createPortalInput({ tokenFile, run: failing.run });
  const started = again.start();
  failing.child.emit('error', new Error('spawn python3 ENOENT'));
  assert.equal(await started, 'unavailable');
});

test('a malformed saved token is not passed on, and a closed portal session stops input', async (t) => {
  const tokenFile = path.join(folder(t), 'token.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ token: 'bad token\nwith a newline' }));
  const helper = fakeHelper();
  const states = [];
  const portal = createPortalInput({
    tokenFile,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    run: helper.run,
    onState: (state) => states.push(state),
  });
  const started = portal.start();
  helper.reply({ ...READY, token: '' });
  await started;
  assert.equal(helper.sent[0], '');
  helper.reply({ type: 'closed' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(portal.state, 'off');
  assert.throws(() => portal.robot.moveMouse(1, 1), { code: 'INPUT_UNAVAILABLE' });
  assert.deepEqual(states, ['asking', 'allowed', 'off']);
});

test(
  'the portal helper is valid Python',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 is not installed' },
  () => {
    const result = spawnSync(
      'python3',
      ['-I', '-c', 'import sys; compile(sys.stdin.read(), "helper", "exec")'],
      { input: HELPER, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  },
);

// Runs the helper's clipboard reading against stand-in portal signals: each case is the options of one
// SelectionOwnerChanged, and the read hands back a pipe holding what the app that copied would write. The test
// passes the helper's own functions (from portal_fd up to transfer) on stdin; this script replaces portal_fd with
// its stand-in, runs the cases, and prints the messages the helper emitted for each one.
const READ_COPIES = String.raw`
import json, os, select, sys, threading, time
TEXT_TYPES = ['text/plain;charset=utf-8', 'text/plain', 'UTF8_STRING', 'STRING', 'TEXT']
LIMIT, copies, session, out, pipes = 1024 * 1024, [0], '/session/1', [], []
def emit(**message): out.append(message)
exec(sys.stdin.read())
def portal_fd(method, signature, kind):
    read, write = os.pipe()
    pipes.append((write, ('copied as ' + kind).encode()))
    return read
def deliver(index):
    write, data = pipes[index]; os.write(write, data); os.close(write)
def settle():
    for thread in threading.enumerate():
        if thread is not threading.current_thread(): thread.join(2)
class Signal:
    def __init__(self, *values): self.values = values
    def unpack(self): return self.values
def copied(options, owner=session): owner_changed(None, None, None, None, None, Signal(owner, options))
results = []
for options in [{'mime_types': (['UTF8_STRING', 'text/plain', 'text/plain;charset=utf-8'],), 'session_is_owner': False}, {'mime_types': ['text/plain']}, {'mime_types': (['image/png'],)}, {'mime_types': (['text/plain'],), 'session_is_owner': True}, {}]:
    del out[:]; asked = len(pipes); copied(options)
    if len(pipes) > asked: deliver(-1)
    settle(); results.append(list(out))
del out[:], pipes[:]
copied({'mime_types': (['text/plain'],)}); copied({'mime_types': (['text/plain;charset=utf-8'],)})
deliver(1); deliver(0); settle(); results.append(list(out))
del out[:]; copied({'mime_types': (['text/plain'],)}, '/session/other'); settle(); results.append(list(out))
print(json.dumps(results))
`;

test(
  'what is copied here is read from the portal, whether its types come as the portal describes or as GNOME sends them',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 is not installed' },
  () => {
    const functions = HELPER.slice(HELPER.indexOf('def portal_fd'), HELPER.indexOf('def transfer'));
    const result = spawnSync('python3', ['-I', '-c', READ_COPIES], {
      input: functions,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const text = (value) => [{ type: 'clipboard', text: `copied as ${value}` }];
    assert.deepEqual(
      JSON.parse(result.stdout),
      [
        text('text/plain;charset=utf-8'),
        text('text/plain'),
        [],
        [],
        [],
        text('text/plain;charset=utf-8'),
        [],
      ],
      'UTF-8 text first; nothing for pictures, for what this session offered itself, or for another session; and a slow read loses to a newer copy',
    );
  },
);

test('the clipboard goes through the portal session: what is copied here is read, and text is offered for pasting', async (t) => {
  const helper = fakeHelper();
  const portal = createPortalInput({
    bounds: { x: 0, y: 0, width: 1920, height: 1200 },
    run: helper.run,
  });
  const started = portal.start();
  helper.reply({ ...READY, clipboard: true });
  await started;
  assert.equal(portal.clipboard.readText(), '', 'nothing until something is copied');
  helper.reply({ type: 'clipboard', text: 'copied in a Wayland app' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(portal.clipboard.readText(), 'copied in a Wayland app');
  portal.clipboard.writeText('from the viewer');
  assert.deepEqual(JSON.parse(helper.sent.at(-1)), { clip: 'from the viewer' });
  assert.equal(portal.clipboard.readText(), 'from the viewer');
  portal.stop();
  assert.throws(() => portal.clipboard.writeText('later'), /waiting for approval/);
});

test('an approval from before the clipboard was asked for is set aside once, so the desktop asks again with it', async (t) => {
  const tokenFile = path.join(folder(t), 'wayland-remote-control.json');
  fs.writeFileSync(tokenFile, JSON.stringify({ token: 'restore-old' }));
  const helper = fakeHelper();
  const portal = createPortalInput({
    tokenFile,
    bounds: { x: 0, y: 0, width: 1920, height: 1200 },
    run: helper.run,
  });
  const started = portal.start();
  helper.reply({ ...READY, token: 'restore-new', clipboard: true });
  await started;
  assert.equal(helper.sent[0], '', 'the old approval is not used');
  assert.deepEqual(JSON.parse(fs.readFileSync(tokenFile, 'utf8')), {
    token: 'restore-new',
    clipboardAsked: true,
  });
});
