'use strict';

// Tests that the Linux packages get the app's icon in the sizes the desktop's icon theme looks in. Ubuntu's app list
// finds an app's icon in /usr/share/icons/hicolor/<size>/apps, for the sizes the hicolor theme lists, up to 512; a
// single 1024-pixel icon there left a generic one. electron-builder installs one PNG per size from build.linux.icon,
// a folder that scripts/generate-icons.py fills. It reads the files only; nothing is built.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

test('the Linux icon folder has the ym icon at every theme size from 16 to 512', () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const folder = path.join(root, build.linux.icon);
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const png = fs.readFileSync(path.join(folder, `${size}x${size}.png`));
    // A PNG's width and height are the 4-byte numbers at bytes 16 and 20, in its header chunk.
    assert.deepEqual(
      [png.readUInt32BE(16), png.readUInt32BE(20)],
      [size, size],
      `${size}x${size}.png`,
    );
  }
  assert.ok(
    !fs.readdirSync(folder).some((file) => file.startsWith('1024x1024')),
    'no size the theme ignores',
  );
});
