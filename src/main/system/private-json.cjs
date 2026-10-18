'use strict';
// Small JSON files that only the current user can read: approved certificates, remembered
// sign-ins, settings and similar notes in the app's data folder. Every write replaces the whole
// file in one step, so the file is never left half-written.
//
// Used by network/trust.cjs, viewing/credentials.cjs, android/general-mode.cjs,
// control/portal-input.cjs and main.cjs.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reads and parses a JSON file. Returns `fallback` when the file is missing, can't be read, isn't
 * valid JSON, or holds just `null`.
 */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Saves `value` as indented JSON in `file`, readable only by the current user (mode 0600, and a
 * new folder gets mode 0700). It writes a temporary file beside the target and renames it over
 * the target, so readers see either the old contents or the new ones. Throws when the file can't
 * be written.
 */
function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // A random name, opened with 'wx' (fail if it exists), so two writes never share one.
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    // Removes the temporary file when the write or the rename failed. After a successful rename
    // the name no longer exists, and the error is ignored.
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}

module.exports = { readJson, writePrivateJson };
