'use strict';

// electron-builder's afterPack hook (build.afterPack in package.json). It runs once on the freshly generated Mac app
// bundle, before electron-builder signs it, and prepares the bundle in two ways:
//  1. It gives the bundle's main executable a build UUID of its own (see mac-build-uuid.cjs). Only the main
//     executable gets one; the helper executables inside the bundle keep theirs.
//  2. It removes the Finder information and resource fork extended attributes (com.apple.FinderInfo and
//     com.apple.ResourceFork) from every file in the bundle, because that metadata in the output prevents signing.
//     It never clears all metadata: quarantine, provenance and unrelated extended attributes remain.
// The paths it works on come from the build, so each one is checked first: the hook refuses to follow a symbolic
// link or a name that could lead outside the bundle.

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { rewriteMachOUuids } = require('./mac-build-uuid.cjs');

const run = promisify(execFile);
const REMOVABLE = ['com.apple.FinderInfo', 'com.apple.ResourceFork'];

/**
 * The hook. `context` is electron-builder's afterPack context: the target platform, the output folder (appOutDir)
 * and the packager, which knows the app's file name and id. Does nothing for builds other than macOS.
 */
module.exports = async function cleanMacMetadata(context) {
  // 'mas' is the Mac App Store build.
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) return;

  // --- Find the bundle and its main executable ---
  // The bundle's name must be a plain file name, with no folders in it.
  const productFilename = context.packager?.appInfo?.productFilename;
  if (
    typeof productFilename !== 'string' ||
    !productFilename ||
    path.basename(productFilename) !== productFilename
  ) {
    throw new Error('Cannot locate the generated macOS app bundle safely.');
  }
  const outputDirectory = await fs.realpath(context.appOutDir);
  const bundle = path.join(outputDirectory, `${productFilename}.app`);
  const bundleStat = await fs.lstat(bundle);
  if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink())
    throw new Error('The generated app bundle must be a real directory.');
  // The main executable is the one the bundle's Info.plist names in CFBundleExecutable.
  const { stdout } = await run(
    '/usr/bin/plutil',
    [
      '-extract',
      'CFBundleExecutable',
      'raw',
      '-o',
      '-',
      path.join(bundle, 'Contents', 'Info.plist'),
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
  const executableName = stdout.trim();
  if (
    !executableName ||
    ['.', '..'].includes(executableName) ||
    path.basename(executableName) !== executableName
  ) {
    throw new Error('Cannot locate the generated main executable safely.');
  }
  // It must be a regular file, not a symbolic link, and its real path must be the expected one, so no link on the
  // way leads outside the bundle.
  const executable = path.join(bundle, 'Contents', 'MacOS', executableName);
  const executableStat = await fs.lstat(executable);
  if (
    !executableStat.isFile() ||
    executableStat.isSymbolicLink() ||
    (await fs.realpath(executable)) !== executable
  ) {
    throw new Error('The generated main executable must be a regular file inside its app bundle.');
  }

  // --- Give it its own build UUID ---
  const patched = rewriteMachOUuids(await fs.readFile(executable), context.packager.appInfo.id);
  await fs.writeFile(executable, patched.data);

  // --- Remove the metadata that prevents signing ---
  const entries = [];

  /** Adds `file` to `entries` and, when it is a real directory, everything inside it. Links are not followed. */
  async function collect(file) {
    entries.push(file);
    const stat = await fs.lstat(file);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const name of await fs.readdir(file)) await collect(path.join(file, name));
  }

  /** Removes the REMOVABLE extended attributes from one file, those it has. */
  async function clean(file) {
    // -s operates on a symlink itself instead of following its target.
    const { stdout } = await run('/usr/bin/xattr', ['-s', file], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const attributes = new Set(stdout.split(/\r?\n/));
    for (const attribute of REMOVABLE) {
      if (attributes.has(attribute))
        await run('/usr/bin/xattr', ['-d', '-s', attribute, file], { timeout: 10000 });
    }
  }

  await collect(bundle);
  // Eight files at a time, so only a few xattr processes run at once.
  for (let offset = 0; offset < entries.length; offset += 8) {
    await Promise.all(entries.slice(offset, offset + 8).map(clean));
  }
};
