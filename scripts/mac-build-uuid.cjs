'use strict';

// Gives the packed Mac app's main executable a build UUID of its own. clean-mac-metadata.cjs (the electron-builder
// afterPack hook) calls it, and test/scripts/mac-build-uuid.test.cjs tests it.
//
// Why: macOS's Local Network privacy setting also identifies applications by their main executable's LC_UUID, a
// 16-byte id stored in the executable's Mach-O load commands. electron-builder repackages Electron's prebuilt
// executable, and a repackaged Electron executable keeps Electron's UUID. The new UUID is derived from the
// application id, the CPU type and subtype, and the original UUID, so the same input always gives the same result.
//
// When: once on each freshly packed main executable, before code signing. Changing these bytes invalidates any
// signature the file had, and running it a second time would derive yet another UUID from the first one. The
// patched executable no longer matches the debug symbols (dSYM) of Electron's original executable.
//
// The file can be a thin Mach-O (one architecture) or a universal ("fat") file that holds several thin slices.
// Every header, slice and load command is checked against the file's bounds before any byte changes, and any
// structure this code doesn't expect is refused with an error instead of being patched.

const { createHash } = require('node:crypto');

/**
 * Replaces the LC_UUID of every architecture in a Mach-O main executable with one derived from `appId`.
 * `input` is the whole executable as a Buffer, thin or universal; it is never modified. `appId` is the application
 * identifier, such as local.yesmachine.desktop. Returns { data, changes }: `data` is a patched copy of the file, and
 * `changes` lists each rewritten UUID as { offset, original, replacement }. Throws, before changing anything, when
 * the identifier is invalid or the file is not a well-formed Mach-O executable.
 */
function rewriteMachOUuids(input, appId) {
  if (!Buffer.isBuffer(input)) throw new TypeError('Expected a Mach-O Buffer.');
  if (typeof appId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(appId)) {
    throw new Error('A valid application identifier is required for the build UUID.');
  }
  const changes = [];
  // Every structural problem ends in this one error, whatever the check that found it.
  const fail = () => {
    throw new Error('Invalid or unsupported main executable Mach-O structure.');
  };
  /**
   * Fails unless `offset` and `size` are safe, non-negative integers and the `size` bytes from `offset` end at or
   * before `end` (the end of the file, by default).
   */
  function bounds(offset, size, end = input.length) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      offset > end - size
    )
      fail();
  }
  /**
   * Checks one thin Mach-O executable of `size` bytes at `start` (the whole file, or one slice of a universal file)
   * and records the change to its LC_UUID. For a slice, `expectedCpu` is its record in the universal file's table,
   * and its CPU type and subtype must match the ones in the slice's own header.
   */
  function thin(start, size, expectedCpu) {
    bounds(start, size);
    if (size < 28) fail();
    // The magic number gives the byte order and the word size. Read big-endian, 0xfeedface (32-bit) and 0xfeedfacf
    // (64-bit) mean a big-endian file; 0xcefaedfe and 0xcffaedfe are the same numbers stored little-endian, as on
    // Intel and Apple silicon Macs.
    const magic = input.readUInt32BE(start);
    const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
    const wide = magic === 0xfeedfacf || magic === 0xcffaedfe;
    if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) fail();
    const read = (offset) =>
      little ? input.readUInt32LE(start + offset) : input.readUInt32BE(start + offset);
    // The header holds 32-bit fields: magic, CPU type (at 4), CPU subtype (8), file type (12), number of load
    // commands (16), their total size in bytes (20) and flags (24). The 64-bit header adds a reserved field.
    const header = wide ? 32 : 28;
    if (size < header || read(12) !== 2) fail(); // File type 2 is MH_EXECUTE: main executables only.
    const cpu = read(4);
    const subtype = read(8);
    if (expectedCpu && (cpu !== expectedCpu.cpu || subtype !== expectedCpu.subtype)) fail();
    const commands = read(16);
    const commandBytes = read(20);
    if (commands < 1 || commands > 4096 || commandBytes > size - header) fail();
    // Walk the load commands. Each one starts with its type and its length in bytes, lies inside the area the
    // header declares for them, and together they must fill that area exactly.
    const end = start + header + commandBytes;
    let offset = start + header;
    let uuidOffset = null;
    for (let index = 0; index < commands; index += 1) {
      bounds(offset, 8, end);
      const command = little ? input.readUInt32LE(offset) : input.readUInt32BE(offset);
      const length = little ? input.readUInt32LE(offset + 4) : input.readUInt32BE(offset + 4);
      if (length < 8 || length % 4 !== 0) fail();
      bounds(offset, length, end);
      if (command === 0x1b) {
        // LC_UUID: its type and length, then the 16-byte UUID. There must be exactly one.
        if (length !== 24 || uuidOffset !== null) fail();
        uuidOffset = offset + 8;
      }
      offset += length;
    }
    if (offset !== end || uuidOffset === null) fail();
    // The new UUID is the first 16 bytes of a SHA-256 over a fixed label, the application id, this slice's CPU type
    // and subtype, and the original UUID.
    const original = input.subarray(uuidOffset, uuidOffset + 16);
    const architecture = Buffer.alloc(8);
    architecture.writeUInt32BE(cpu, 0);
    architecture.writeUInt32BE(subtype, 4);
    const replacement = createHash('sha256')
      .update('yes-machine:main-build-uuid:v1\0')
      .update(appId)
      .update('\0')
      .update(architecture)
      .update(original)
      .digest()
      .subarray(0, 16);
    // Mark it as a version 8 UUID (a custom one, here deterministic per application), with the standard variant
    // bits (binary 10) at the top of byte 8.
    replacement[6] = (replacement[6] & 0x0f) | 0x80;
    replacement[8] = (replacement[8] & 0x3f) | 0x80;
    // Only recorded for now: the bytes are written once every slice has passed its checks.
    changes.push({
      offset: uuidOffset,
      original: Buffer.from(original),
      replacement: Buffer.from(replacement),
    });
  }

  // A universal file starts with its own header: a magic number and the number of slices, then a table with one
  // record per slice: CPU type, CPU subtype, offset, size and alignment, 20 bytes each. The 64-bit form of the table
  // has 64-bit offsets and sizes and a reserved field, 32 bytes per record. These headers are normally big-endian;
  // the byte-swapped magics are accepted too.
  bounds(0, 4);
  const magic = input.readUInt32BE(0);
  if ([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) {
    bounds(0, 8);
    const little = magic === 0xbebafeca || magic === 0xbfbafeca;
    const wide = magic === 0xcafebabf || magic === 0xbfbafeca;
    const read = (offset) => (little ? input.readUInt32LE(offset) : input.readUInt32BE(offset));
    // A 64-bit offset or size too large for a Number to hold exactly fails the bounds check.
    const read64 = (offset) =>
      Number(little ? input.readBigUInt64LE(offset) : input.readBigUInt64BE(offset));
    const count = read(4);
    const recordSize = wide ? 32 : 20;
    if (count < 1 || count > 64) fail();
    const tableEnd = 8 + count * recordSize;
    bounds(0, tableEnd);
    // Each slice must lie inside the file, after the table, without overlapping another slice.
    const slices = [];
    for (let index = 0; index < count; index += 1) {
      const record = 8 + index * recordSize;
      const start = wide ? read64(record + 8) : read(record + 8);
      const size = wide ? read64(record + 16) : read(record + 12);
      bounds(start, size);
      if (
        start < tableEnd ||
        slices.some((slice) => start < slice.start + slice.size && slice.start < start + size)
      )
        fail();
      slices.push({ start, size, cpu: read(record), subtype: read(record + 4) });
    }
    for (const slice of slices) thin(slice.start, slice.size, slice);
  } else {
    thin(0, input.length);
  }
  // Every slice has been checked by now. The new UUIDs go into a copy, so the caller's buffer never changes.
  const data = Buffer.from(input);
  for (const change of changes) change.replacement.copy(data, change.offset);
  return { data, changes };
}

module.exports = { rewriteMachOUuids };
