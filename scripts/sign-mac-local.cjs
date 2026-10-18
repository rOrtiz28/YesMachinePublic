'use strict';
// electron-builder's afterSign hook (build.afterSign in package.json). When this Mac has a "Yes Machine Local
// Signing" certificate in its keychain (made once by create-mac-signing-certificate.sh; see the README), it re-signs
// the build with it. macOS then knows every rebuild as the same app and keeps its Screen Recording and Accessibility
// permissions; with an ad hoc signature, each build is a different app. Without the certificate, the ad hoc
// signature stays as it is.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const NAME = 'Yes Machine Local Signing';

/**
 * The SHA-1 hash that names the local signing identity, as `security find-identity` lists it, or null when the
 * keychain has no such identity or the command fails.
 */
function localIdentity() {
  try {
    const listing = execFileSync('/usr/bin/security', ['find-identity', '-p', 'codesigning'], {
      encoding: 'utf8',
    });
    const line = listing.split('\n').find((entry) => entry.includes(`"${NAME}"`));
    return line ? (/\b([0-9A-F]{40})\b/.exec(line)?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * The hook. For a macOS build, re-signs the whole app with the local identity, including everything nested inside
 * it (--deep), then verifies the signature; a failure in either step stops the build.
 */
exports.default = async function signWithLocalCertificate(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const identity = localIdentity();
  if (!identity) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', identity, app], {
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • signed with ${NAME}`);
};
