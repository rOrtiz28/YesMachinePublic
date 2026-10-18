'use strict';

// Tests the QR code encoder for the pairing code of Android's wireless debugging (src/main/android/qr.cjs) against
// the standard, ISO/IEC 18004: its worked example and published tables, how much text each version holds, and where
// the fixed patterns of a whole code fall. The encoder runs on its own; nothing else is involved.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  encode,
  errorCorrection,
  formatBits,
  versionBits,
  versionFor,
} = require('../../src/main/android/qr.cjs');

test("error correction matches the standard's worked example", () => {
  // ISO/IEC 18004 annex I: "01234567" as version 1-M.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(errorCorrection(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('format and version information match the published tables', () => {
  const levelM = [
    '101010000010010',
    '101000100100101',
    '101111001111100',
    '101101101001011',
    '100010111111001',
    '100000011001110',
    '100111110010111',
    '100101010100000',
  ];
  levelM.forEach((bits, mask) =>
    assert.equal(formatBits(mask).toString(2).padStart(15, '0'), bits, `mask ${mask}`),
  );
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(10), 0x0a4d3);
});

test('the smallest version that holds the text is used', () => {
  assert.equal(versionFor(14), 1);
  assert.equal(versionFor(15), 2);
  assert.equal(versionFor(52), 4);
  assert.equal(versionFor(213), 10);
  assert.throws(() => versionFor(214), /too long/);
});

test('a pairing code has the fixed patterns where readers look for them', () => {
  const modules = encode('WIFI:T:ADB;S:yes-machine-1a2b3c4d;P:k3J9xQ2mP7wZ;;');
  const size = modules.length;
  assert.equal(size, 33); // version 4
  assert.ok(modules.every((row) => row.length === size));
  // The 7 × 7 modules from (x0, y0), as text: # for dark, . for light, and a slash between rows.
  const finder = (x0, y0) =>
    [...Array(7)]
      .map((_, y) => [...Array(7)].map((_, x) => (modules[y0 + y][x0 + x] ? '#' : '.')).join(''))
      .join('/');
  const expected = '#######/#.....#/#.###.#/#.###.#/#.###.#/#.....#/#######';
  assert.equal(finder(0, 0), expected);
  assert.equal(finder(size - 7, 0), expected);
  assert.equal(finder(0, size - 7), expected);
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0, `timing row at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0, `timing column at ${i}`);
  }
  assert.equal(modules[size - 8][8], true); // the dark module
  // Both copies of the format information agree.
  const first = [0, 1, 2, 3, 4, 5, 7, 8]
    .map((y) => modules[y][8])
    .concat([7, 5, 4, 3, 2, 1, 0].map((x) => modules[8][x]));
  const second = [...Array(8)]
    .map((_, i) => modules[8][size - 1 - i])
    .concat([...Array(7)].map((_, i) => modules[size - 7 + i][8]));
  assert.deepEqual(first, second);
});
