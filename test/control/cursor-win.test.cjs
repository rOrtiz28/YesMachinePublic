'use strict';

// Tests the Windows helper that blanks the cursor while a viewer with a mouse has control
// (src/main/control/cursor-win.cjs). No PowerShell runs: `run` is a stand-in that records each start and returns a
// fake child process, whose stdin records what it is told and whose stdout the tests use to send the helper's
// reports. The last test reads the helper's C# source for the lines that matter.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowsCursor, HELPER } = require('../../src/main/control/cursor-win.cjs');

/**
 * A stand-in for child_process.spawn. Each child records the text written to its stdin (`written`) and whether
 * stdin was closed (`ended`), and its stdout and the child itself are event emitters the tests can fire. `started`
 * lists every start with its file, arguments, options and child.
 */
function fakeRun() {
  const started = [];
  const run = (file, args, options) => {
    const child = new EventEmitter();
    child.written = [];
    child.ended = false;
    child.stdin = Object.assign(new EventEmitter(), {
      write: (text) => child.written.push(text),
      end: () => {
        child.ended = true;
      },
    });
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.kill = () => {};
    started.push({ file, args, options, child });
    return child;
  };
  return { run, started };
}

test('hide starts the helper in hidden PowerShell and tells it to blank the cursors', () => {
  const { run, started } = fakeRun();
  const marks = [];
  const cursor = createWindowsCursor({ run, marked: (on) => marks.push(on) });
  cursor.stop();
  assert.equal(started.length, 0); // nothing was hidden, so nothing to give back
  assert.deepEqual(marks, []);
  cursor.hide();
  cursor.hide();
  assert.equal(started.length, 1);
  const [{ file, args, options, child }] = started;
  assert.equal(file, 'powershell.exe');
  assert.deepEqual(args.slice(0, 5), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
  ]);
  assert.equal(args[5], HELPER);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(child.written, ['hide\n', 'hide\n']);
  assert.deepEqual(marks, [true, true]);
});

test('shapes arrive as the helper reports them, split anywhere, and anything else is ignored', () => {
  const { run, started } = fakeRun();
  const shapes = [];
  const cursor = createWindowsCursor({ run, onShape: (shape) => shapes.push(shape) });
  cursor.hide();
  const { stdout } = started[0].child;
  stdout.emit('data', 'shape def');
  stdout.emit('data', 'ault\r\nshape text\nwhatever\nshape <script>\nshape ');
  stdout.emit('data', 'pointer\n');
  assert.deepEqual(shapes, ['default', 'text', 'pointer']);
});

test('stop closes stdin, so the helper gives the cursors back, and the next hide starts a new helper', () => {
  const { run, started } = fakeRun();
  const marks = [];
  const cursor = createWindowsCursor({ run, marked: (on) => marks.push(on) });
  cursor.hide();
  cursor.stop();
  assert.equal(started[0].child.ended, true);
  assert.deepEqual(marks, [true, false]);
  cursor.hide();
  assert.equal(started.length, 2);
  assert.deepEqual(started[1].child.written, ['hide\n']);
  started[1].child.emit('exit'); // the helper went away: the next hide starts it again
  cursor.hide();
  assert.equal(started.length, 3);
});

test('restore runs a helper only to give the cursors back, after one was killed along with Yes Machine', () => {
  const { run, started } = fakeRun();
  const marks = [];
  createWindowsCursor({ run, marked: (on) => marks.push(on) }).restore();
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].child.written, []);
  assert.equal(started[0].child.ended, true);
  assert.deepEqual(marks, [false]);
});

test('show keeps the helper and tells it the viewer no longer wants its own pointer', () => {
  const { run, started } = fakeRun();
  const marks = [];
  const cursor = createWindowsCursor({ run, marked: (on) => marks.push(on) });
  cursor.show();
  assert.equal(started.length, 0);
  cursor.hide();
  cursor.show();
  assert.deepEqual(started[0].child.written, ['hide\n', 'show\n']);
  assert.equal(started[0].child.ended, false);
  assert.deepEqual(marks, [true, false]);
});

test('the helper gives back the cursors when it starts, when its stdin closes, and to a moving mouse here', () => {
  assert.match(HELPER, /public static void Run\(\) \{\s*Restore\(\);/);
  assert.match(
    HELPER,
    /wanted = false;\s*lock \(Lock\) \{ Restore\(\); blank = false; \}\s*Environment\.Exit\(0\);/,
  );
  assert.match(HELPER, /SystemParametersInfo\(0x57, 0, IntPtr\.Zero, 0\)/);
  // Moves Windows marks as injected (LLMHF_INJECTED, in the hook data's flags) are the viewer's; others are local.
  assert.match(HELPER, /SetWindowsHookEx\(14,/);
  assert.match(
    HELPER,
    /\(Marshal\.ReadInt32\(l, 12\) & 1\) != 0\) Interlocked\.Exchange\(ref lastInjected/,
  );
  assert.match(HELPER, /if \(blank && \(!wanted \|\| local\)\) \{ Restore\(\); blank = false; \}/);
  assert.match(
    HELPER,
    /else if \(!blank && wanted && !local && viewer\) \{ Blank\(\); blank = true; \}/,
  );
});
