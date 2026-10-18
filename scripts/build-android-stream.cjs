'use strict';
// Builds the device side of Android advanced mode, android/stream, into android/stream/build/yes-machine-stream.jar:
// Java compiled against Android's API, then converted to Android bytecode with d8. The computer pushes the jar to the
// device and starts it there with app_process (see src/main/android/advanced-mode.cjs). Run it with
// `npm run android-stream`; electron-builder also runs it as its beforePack hook, so every package carries a server
// built from this source. A failed build leaves the previous jar in place. The tests in
// test/android/advanced-mode.test.cjs use findTools and sortVersions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE = path.join(__dirname, '../android/stream/src');
const JAR = path.join(__dirname, '../android/stream/build/yes-machine-stream.jar');

const MIN_PLATFORM = 31; // Android 12, the first with the attribution source that recording sound needs

// --- Finding the Android SDK ---

/**
 * Sorts version names such as android-36.1 or 36.1.0, lowest version first, comparing their numbers one by one
 * (a missing number counts as 0). Returns a new array.
 */
function sortVersions(names) {
  const numbers = (name) => (name.match(/\d+/g) || []).map(Number);
  return [...names].sort((a, b) => {
    const aNumbers = numbers(a),
      bNumbers = numbers(b);
    for (let i = 0; i < Math.max(aNumbers.length, bNumbers.length); i++)
      if ((aNumbers[i] || 0) !== (bNumbers[i] || 0)) return (aNumbers[i] || 0) - (bNumbers[i] || 0);
    return 0;
  });
}

/**
 * The Android SDK's platform library and d8, as { platform, d8 } paths, or null without an SDK that has both. The
 * SDK is the first of ANDROID_HOME, ANDROID_SDK_ROOT and the usual install folders on macOS, Linux and Windows that
 * has a platforms folder. The code compiles against the oldest platform it can (at least MIN_PLATFORM), so no call
 * links to a method that only newer devices have; d8 is the newest. The parameters default to the real environment
 * and file system; the tests pass their own.
 */
function findTools(
  env = process.env,
  home = os.homedir(),
  exists = fs.existsSync,
  list = fs.readdirSync,
) {
  const sdk = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    path.join(home, 'Library', 'Android', 'sdk'),
    path.join(home, 'Android', 'Sdk'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk'),
  ].find((directory) => directory && exists(path.join(directory, 'platforms')));
  if (!sdk) return null;
  // The versions inside `directory` (such as platforms/android-36) that contain `file`, lowest first.
  const having = (directory, file) =>
    exists(directory)
      ? sortVersions(list(directory).filter((name) => exists(path.join(directory, name, file))))
      : [];
  const platform = having(path.join(sdk, 'platforms'), 'android.jar').find(
    (name) => Number(name.match(/\d+/)?.[0]) >= MIN_PLATFORM,
  );
  const d8 = having(path.join(sdk, 'build-tools'), path.join('lib', 'd8.jar')).pop();
  return platform && d8
    ? {
        platform: path.join(sdk, 'platforms', platform, 'android.jar'),
        d8: path.join(sdk, 'build-tools', d8, 'lib', 'd8.jar'),
      }
    : null;
}

// --- Building the jar ---

/** The files in `directory` and its subfolders whose names end with `extension`, as full paths. */
function files(directory, extension) {
  return fs
    .readdirSync(directory, { recursive: true })
    .filter((name) => name.endsWith(extension))
    .map((name) => path.join(directory, name));
}

/**
 * Compiles the stream server and puts the jar in place. javac compiles it as Java 8, with the platform's
 * android.jar as the boot class path, so only Android's own API is available. d8 then converts the classes into
 * Android bytecode for API level 29 (Android 10) and up. Both steps work in a temporary folder that is removed
 * afterwards, and the jar is copied into place only when both succeed.
 */
function build({ platform, d8 }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'yes-machine-stream-'));
  try {
    const classes = path.join(work, 'classes'),
      jar = path.join(work, 'yes-machine-stream.jar');
    // The JDK's tools come from JAVA_HOME when it is set, otherwise from the PATH.
    const java = (name) =>
      process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
    execFileSync(
      java('javac'),
      [
        '-source',
        '8',
        '-target',
        '8',
        '-bootclasspath',
        platform,
        '-Xlint:-options',
        '-d',
        classes,
        ...files(SOURCE, '.java'),
      ],
      { stdio: 'inherit' },
    );
    execFileSync(
      java('java'),
      [
        '-cp',
        d8,
        'com.android.tools.r8.D8',
        '--release',
        '--min-api',
        '29',
        '--lib',
        platform,
        '--output',
        jar,
        ...files(classes, '.class'),
      ],
      { stdio: 'inherit' },
    );
    fs.mkdirSync(path.dirname(JAR), { recursive: true });
    fs.copyFileSync(jar, JAR);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Builds the jar when the Android SDK is found. Without the Android SDK, a jar built earlier on this computer is
 * packed as it is; with no jar either, it fails, because a package without the stream server has no advanced mode.
 * This is the function electron-builder calls before packing.
 */
async function buildAndroidStream() {
  const tools = findTools();
  if (tools) build(tools);
  else if (fs.existsSync(JAR))
    console.log(
      `  • no Android SDK found, packing the stream server built earlier  file=${path.relative(process.cwd(), JAR)}`,
    );
  else
    throw Error(
      'Android advanced mode needs its stream server, and building it needs the Android SDK (set ANDROID_HOME) and a JDK.',
    );
}

module.exports = buildAndroidStream;
module.exports.findTools = findTools;
module.exports.sortVersions = sortVersions;

// Run directly, as `npm run android-stream` does.
if (require.main === module) {
  buildAndroidStream().then(
    () => console.log(`built ${path.relative(process.cwd(), JAR)}`),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
