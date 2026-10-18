'use strict';

// Tests that both apps carry the licenses that must come with them: Yes Machine's own (LICENSE), the notices of the
// software they include (THIRD_PARTY_NOTICES.md) and the fonts' licenses, plus, in a Mac app, Electron's and
// Chromium's, which electron-builder copies beside the program on Windows and Linux but leaves out on a Mac. It
// also checks that the notices list every package the desktop app includes, so a dependency that is added, removed
// or updated changes them too. It reads the build settings and the notices only; nothing is built.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A file of the project, as text.
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const notices = read('THIRD_PARTY_NOTICES.md');
const gradle = read('android/app/build.gradle');
// The fonts' licenses, in public/.
const fontLicenses = ['fonts/OFL-PixelifySans.txt', 'fonts/OFL-JetBrainsMono.txt'];

test('the desktop app packs the license, the notices, the fonts’ licenses and Electron’s', () => {
  const { build } = JSON.parse(read('package.json'));
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'public/**']) {
    assert.ok(build.files.includes(file), `${file} is not packed`);
  }
  for (const file of fontLicenses) {
    assert.match(read(`public/${file}`), /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  const inMacResources = new Map(build.mac.extraResources.map(({ from, to }) => [to, from]));
  assert.equal(inMacResources.get('LICENSE.electron.txt'), 'node_modules/electron/dist/LICENSE');
  assert.equal(
    inMacResources.get('LICENSES.chromium.html'),
    'node_modules/electron/dist/LICENSES.chromium.html',
  );
});

test('the Android app copies the license, the notices and the fonts’ licenses into its assets', () => {
  assert.match(gradle, /from\('\.\.\/\.\.'\) \{ include 'LICENSE', 'THIRD_PARTY_NOTICES\.md' \}/);
  const fromPublic = gradle.slice(gradle.indexOf("from('../../public') {"));
  const copied = fromPublic.slice(0, fromPublic.indexOf('}'));
  for (const file of fontLicenses) {
    assert.ok(copied.includes(`'${file}'`), `${file} is not copied into the app`);
  }
});

test('the notices list every package the desktop app includes, at its version and license', () => {
  // The packages in package-lock.json that aren't only for development, as "name version license".
  const { packages } = JSON.parse(read('package-lock.json'));
  const included = Object.entries(packages)
    .filter(([where, info]) => where.startsWith('node_modules/') && !info.dev)
    .map(
      ([where, { version, license }]) =>
        `${where.split('node_modules/').pop()} ${version} ${license}`,
    );
  // The rows of the desktop app's table: | [name](link) | version | license |
  const desktop = notices.slice(
    notices.indexOf('## The desktop app'),
    notices.indexOf('## The fonts'),
  );
  const listed = [...desktop.matchAll(/^\| \[([^\]]+)\]\([^)]*\) \| (\S+) \| (\S+) \|$/gm)].map(
    ([, name, version, license]) => `${name} ${version} ${license}`,
  );
  assert.deepEqual(listed.sort(), included.sort());

  const { devDependencies } = JSON.parse(read('package.json'));
  assert.ok(notices.includes(`[Electron](https://www.electronjs.org) ${devDependencies.electron}`));
  const [, okhttp] = gradle.match(/'com\.squareup\.okhttp3:okhttp:([^']+)'/);
  assert.ok(notices.includes(`| [OkHttp](https://square.github.io/okhttp/) | ${okhttp} |`));
});
