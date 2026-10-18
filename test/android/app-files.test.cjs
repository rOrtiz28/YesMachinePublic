'use strict';

// Tests that the Android app can load every file its web pages ask for. It reads the source only, nothing is built
// or run: the pages' HTML, the Gradle build (android/app/build.gradle), whose include lists copy files into the app,
// and the Java that serves those files to each page (MainActivity for the home page and the viewer, ShareActivity
// for the share dialog).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A file of the project, as text.
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
// The scripts and style sheets a page asks for, by their path on the app's own origin.
const wanted = (html) =>
  [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="(\/[^"]+\.(?:js|css))"/g)].map(
    ([, file]) => file,
  );
// The files the Android build copies into the app, and the ones the app serves to each page.
const gradle = read('android/app/build.gradle'),
  activity = read('android/app/src/main/java/local/yesmachine/android/MainActivity.java');
const bundled = new Set(
  [...gradle.matchAll(/include ([^}]+)}/g)].flatMap(([, list]) =>
    [...list.matchAll(/'([^']+)'/g)].map(([, file]) => file),
  ),
);
// MainActivity serves each page from its own list: the files every page may load, then the home page's, then the
// viewer's. puts() collects the paths a piece of Java adds with files.put(...), and the Java is cut where each list
// starts and ends.
const puts = (code) =>
  new Set([...code.matchAll(/files\.put\(\s*"(\/[^"]*)"/g)].map(([, file]) => file));
const assets = activity.slice(activity.indexOf('WebResourceResponse localAsset('));
const homeStart = assets.indexOf('if (isHome) {'),
  viewerStart = assets.indexOf('} else {', homeStart),
  viewerEnd = assets.indexOf('}', viewerStart + '} else {'.length);
const common = puts(assets.slice(0, homeStart)),
  servedToHome = puts(assets.slice(homeStart, viewerStart)),
  servedToViewer = puts(assets.slice(viewerStart, viewerEnd));

test('every file the Android app’s pages ask for is bundled and served to that page', () => {
  const pages = {
    home: [read('android/app/src/main/home/home.html'), servedToHome],
    viewer: [read('public/client.html'), servedToViewer],
  };
  assert.ok(common.has('/pixel-icons.js') && common.has('/pixel-scene.js'));
  for (const [name, [html, files]] of Object.entries(pages)) {
    for (const file of wanted(html)) {
      assert.ok(
        bundled.has(file.slice(1)) || file === '/android-bridge.js',
        `${file}, which the ${name} page loads, is not copied into the app`,
      );
      assert.ok(
        files.has(file) || common.has(file),
        `${file}, which the ${name} page loads, is not served to it`,
      );
    }
  }
});

test('the share dialog’s page is bundled, and ShareActivity serves it what it asks for', () => {
  const share = read('android/app/src/main/java/local/yesmachine/android/ShareActivity.java');
  const servedByShare = puts(share);
  const html = read('android/app/src/main/share/share.html');
  assert.ok(bundled.has('share.html') && servedByShare.has('/share.html'));
  for (const file of wanted(html)) {
    assert.ok(
      bundled.has(file.slice(1)),
      `${file}, which the share page loads, is not copied into the app`,
    );
    assert.ok(servedByShare.has(file), `${file}, which the share page loads, is not served to it`);
  }
});
