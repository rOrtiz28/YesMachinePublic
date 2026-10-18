'use strict';

// Tests the check for VMware's virtual graphics card (src/main/system/gpu.cjs), which decides whether Chromium may
// use the card although it is on Chromium's blocklist. The registry query is a stand-in: `run` returns what reg.exe
// would print, so the tests need neither Windows nor a virtual machine.

const test = require('node:test');
const assert = require('node:assert/strict');
const { vmwareGraphics } = require('../../src/main/system/gpu.cjs');

// What reg.exe prints for one display adapter whose PCI vendor is `vendor` (15AD is VMware, 10DE NVIDIA).
const REG = (vendor) =>
  `\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\r\n    MatchingDeviceId    REG_SZ    PCI\\VEN_${vendor}&DEV_0406&SUBSYS_040615AD&REV_00\r\n\r\nEnd of search: 1 match(es) found.\r\n`;

test("Windows: VMware's graphics card is found in the display adapters' registry entries", () => {
  let asked = null;
  const run = (file, args) => {
    asked = [file, args];
    return REG('15AD');
  };
  assert.equal(vmwareGraphics({ platform: 'win32', run }), true);
  assert.match(asked[0], /System32\\reg\.exe$/);
  assert.deepEqual(asked[1].slice(2), ['/s', '/v', 'MatchingDeviceId']);
  assert.equal(vmwareGraphics({ platform: 'win32', run: () => REG('10DE') }), false); // a real card
  assert.equal(vmwareGraphics({ platform: 'win32', run: () => '' }), false);
  assert.equal(
    vmwareGraphics({
      platform: 'win32',
      run: () => {
        throw Error('no reg');
      },
    }),
    false,
  );
});

test("Linux and macOS keep Chromium's own decision, even with VMware's card", () => {
  let asked = false;
  const run = () => {
    asked = true;
    return REG('15AD');
  };
  assert.equal(vmwareGraphics({ platform: 'linux', run }), false); // it froze GNOME Shell on Wayland
  assert.equal(vmwareGraphics({ platform: 'darwin', run }), false);
  assert.equal(asked, false);
});
