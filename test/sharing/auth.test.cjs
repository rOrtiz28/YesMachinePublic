'use strict';

// Tests the sign-in check against this computer's own accounts (src/main/sharing/auth.cjs). The real helpers need a
// real account password, so these tests replace the runner and check what reaches it: which program would run, with
// which arguments, and what it would read on stdin. refuseDelay: 0 skips the pause before refusing another account,
// except in the last test, which times it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticator, HELPERS } = require('../../src/main/sharing/auth.cjs');

/**
 * A stand-in runner that records each call as { command, args, input } and answers `result`, as the helper would
 * for a right (true) or wrong (false) password.
 */
function recorder(result = true) {
  const calls = [];
  return {
    calls,
    runner: async (command, args, input) => {
      calls.push({ command, args, input });
      return result;
    },
  };
}

test('only the account running Yes Machine can sign in, and the password never appears in arguments', async () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const { calls, runner } = recorder();
    const authenticate = createAuthenticator({ platform, account: 'alex', runner, refuseDelay: 0 });
    assert.equal(await authenticate('alex', 's3cret pass'), true, platform);
    assert.equal(
      await authenticate('root', 's3cret pass'),
      false,
      `${platform} refuses another account`,
    );
    assert.equal(calls.length, 1, `${platform} runs one helper`);
    assert.ok(
      !calls[0].args.some((arg) => arg.includes('s3cret')),
      `${platform} keeps the password out of arguments`,
    );
    assert.ok(calls[0].input.endsWith('s3cret pass'), `${platform} sends the password on stdin`);
  }
});

test('each platform uses the helper that ships with it', async () => {
  const seen = {};
  for (const platform of ['linux', 'darwin', 'win32']) {
    const { calls, runner } = recorder();
    await createAuthenticator({ platform, account: 'alex', runner, refuseDelay: 0 })('alex', 'pw');
    seen[platform] = calls[0];
  }
  assert.deepEqual(seen.linux.args.slice(0, 2), ['-I', '-c']);
  assert.equal(seen.linux.command, 'python3');
  assert.equal(seen.linux.args.at(-1), 'alex');
  assert.equal(seen.darwin.command, '/usr/bin/osascript');
  assert.equal(seen.darwin.args.at(-1), 'alex');
  assert.equal(seen.win32.command, 'powershell.exe');
  assert.equal(seen.win32.input, 'alex\npw');
  assert.match(HELPERS.LINUX, /pam_start\(b'login'/);
  assert.match(HELPERS.MACOS, /verifyPasswordError/);
  assert.match(HELPERS.WINDOWS, /LogonUser/);
});

test('account names follow each platform and bad input never reaches a helper', async () => {
  const { calls, runner } = recorder();
  assert.equal(
    await createAuthenticator({ platform: 'linux', account: 'alex', runner, refuseDelay: 0 })(
      'Alex',
      'pw',
    ),
    false,
    'Linux names are case-sensitive',
  );
  assert.equal(
    await createAuthenticator({ platform: 'darwin', account: 'alex', runner, refuseDelay: 0 })(
      ' Alex ',
      'pw',
    ),
    true,
    'macOS accepts any case',
  );
  const linux = createAuthenticator({ platform: 'linux', account: 'alex', runner, refuseDelay: 0 });
  for (const [user, password] of [
    ['alex', ''],
    ['alex', 'x'.repeat(1025)],
    [null, 'pw'],
    ['alex', 42],
  ])
    assert.equal(await linux(user, password), false);
  assert.equal(
    await createAuthenticator({ platform: 'freebsd', account: 'alex', runner })('alex', 'pw'),
    false,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    await createAuthenticator({
      platform: 'linux',
      account: 'alex',
      runner: recorder(false).runner,
    })('alex', 'wrong'),
    false,
  );
});

test('another account waits as long as a wrong password before being refused', async () => {
  const started = Date.now();
  assert.equal(
    await createAuthenticator({
      platform: 'linux',
      account: 'alex',
      runner: recorder().runner,
      refuseDelay: 150,
    })('root', 'pw'),
    false,
  );
  assert.ok(Date.now() - started >= 140);
});
