'use strict';

// Tests Settings' lists of what can be forgotten (public/forget-lists.js): the order of the entries, the line under
// each name, what Forget says, and the words of each kind of list, with the real functions run in Node. It also checks
// that both pages that use it, the desktop app's main window and the Android app's home screen, have its rows and load
// it before the scripts that make the lists.

const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/markup.cjs');
const { KINDS, newestFirst, detailOf, forgetLabel } = require('../../public/forget-lists.js');

// October 21 and 17, 2026, at noon in UTC, which is the same day in every time zone the tests run in.
const OCT_21 = Date.UTC(2026, 9, 21, 12),
  OCT_17 = Date.UTC(2026, 9, 17, 12);

test('entries come newest first, and those kept before dates were come last', () => {
  const entries = [
    { id: 'old', since: 0 },
    { id: 'oct17', since: OCT_17 },
    { id: 'oct21', since: OCT_21 },
    { id: 'older', since: 0 },
  ];
  assert.deepEqual(
    newestFirst(entries).map((entry) => entry.id),
    ['oct21', 'oct17', 'old', 'older'],
  );
});

test('the line under a name has the account, system, address and date, or says the date is not recorded', () => {
  assert.deepEqual(
    detailOf(
      {
        name: 'Studio Mac',
        account: 'alex',
        system: 'macOS',
        address: '10.0.0.5:4777',
        since: OCT_21,
      },
      'Remembered since',
    ),
    { text: 'as alex · macOS · 10.0.0.5:4777', date: 'Remembered since Oct 21, 2026' },
  );
  // Without a name the address heads the entry, so the line doesn't repeat it.
  assert.deepEqual(detailOf({ name: '', address: '10.0.0.6:4777', since: 0 }, 'Trusted'), {
    text: '',
    date: 'Date not recorded',
  });
});

test('Forget says how many it forgets, or all', () => {
  assert.equal(forgetLabel(0, 4), 'Forget');
  assert.equal(forgetLabel(2, 4), 'Forget 2');
  assert.equal(forgetLabel(4, 4), 'Forget all');
});

test('each kind of list sums itself up, and its notice names the one forgotten or counts them', () => {
  assert.equal(KINDS.saved.summary(0), 'No saved computers yet.');
  assert.equal(KINDS.saved.summary(1), '1 saved computer.');
  assert.equal(
    KINDS.trusted.summary(3),
    '3 trusted computers. A changed certificate always asks again.',
  );
  assert.equal(
    KINDS.trusted.forgot([{ name: 'Office PC' }]),
    'Forgot Office PC’s certificate. It asks to be verified again.',
  );
  assert.equal(
    KINDS.trusted.forgot([{ name: '', address: '10.0.0.6:4777' }]),
    'Forgot 10.0.0.6:4777’s certificate. It asks to be verified again.',
  );
  assert.equal(
    KINDS.credentials.forgot([{ name: 'A' }, { name: 'B' }]),
    'Forgot 2 remembered sign-ins. They ask for the password again.',
  );
  assert.equal(
    KINDS.allowed.forgot([{ name: 'Office PC' }]),
    'Forgot Office PC. It asks before taking control again.',
  );
  for (const kind of Object.values(KINDS)) assert.match(kind.summary(0), /^No /);
});

test('both pages have the rows and load the lists before the scripts that make them', () => {
  for (const [file, rows, scripts] of [
    [
      'src/windows/host/host.html',
      ['saved', 'credentials', 'trusted'],
      ['src="../../../public/forget-lists.js"', 'src="settings.js"'],
    ],
    [
      'android/app/src/main/home/home.html',
      ['allowed', 'saved', 'credentials', 'trusted'],
      ['src="/forget-lists.js"', 'src="/general-mode.js"'],
    ],
  ]) {
    const html = read(file);
    for (const row of rows)
      assert.match(
        html,
        new RegExp(`class="setting list-setting" id="${row}-setting"`),
        `${file}: ${row}`,
      );
    assert.ok(html.indexOf(scripts[0]) > 0, `${file} loads forget-lists.js`);
    assert.ok(html.indexOf(scripts[0]) < html.indexOf(scripts[1]), `${file}: before ${scripts[1]}`);
  }
});
