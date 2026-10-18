'use strict';

// Tests scripts/mac-build-uuid.cjs, which gives the packed Mac app's main executable an LC_UUID of its own. Instead of
// real executables, the tests build tiny Mach-O files in memory: thin ones with a header and two load commands
// (LC_UUID and LC_CODE_SIGNATURE), and universal ones that hold two such slices. The real rewrite runs on them, and
// the tests check which bytes change, that the new UUIDs are deterministic, and that malformed files are refused
// without being modified. The offsets in the malformed cases point at fields of these small files.

const test = require('node:test');
const assert = require('node:assert/strict');
const { rewriteMachOUuids } = require('../../scripts/mac-build-uuid.cjs');

// The application id the Mac build uses (build.appId in package.json).
const appId = 'local.yesmachine.desktop';

/**
 * A stand-in thin Mach-O executable: its header, an LC_UUID command, an LC_CODE_SIGNATURE command that points at
 * the last 96 bytes, and filler bytes (0xa5) everywhere else. Options choose the byte order (`little`), the word
 * size (`wide` is 64-bit), the CPU type (arm64 by default) and the UUID. Returns the bytes and the UUID's offset.
 */
function thin({
  little = true,
  wide = true,
  cpu = 0x0100000c,
  uuid = Buffer.alloc(16, 0x42),
} = {}) {
  const header = wide ? 32 : 28;
  const data = Buffer.alloc(header + 40 + 96, 0xa5);
  const write = (value, offset) =>
    little ? data.writeUInt32LE(value, offset) : data.writeUInt32BE(value, offset);
  // The header: magic, CPU type, CPU subtype 0, file type 2 (MH_EXECUTE), and two load commands of 40 bytes in all.
  write(wide ? 0xfeedfacf : 0xfeedface, 0);
  write(cpu, 4);
  write(0, 8);
  write(2, 12);
  write(2, 16);
  write(40, 20);
  // LC_UUID (0x1b), 24 bytes long, then the UUID itself.
  write(0x1b, header);
  write(24, header + 4);
  uuid.copy(data, header + 8);
  write(0x1d, header + 24); // LC_CODE_SIGNATURE is intentionally left untouched before resigning.
  write(16, header + 28);
  write(header + 40, header + 32);
  write(96, header + 36);
  return { data, offset: header + 8 };
}

/**
 * A stand-in universal file: an x86-64 slice at byte 256 and an arm64 slice at byte 512, both thin() files.
 * Options choose the form of the slice table (`wide` uses 64-bit records) and its byte order (big-endian by default,
 * as real universal files are). Returns the bytes and the offsets of both UUIDs.
 */
function fat({ wide = false, little = false } = {}) {
  const slices = [thin({ cpu: 0x01000007 }), thin({ cpu: 0x0100000c })];
  const recordSize = wide ? 32 : 20;
  const starts = [256, 512];
  const data = Buffer.alloc(768, 0);
  const write = (value, offset) =>
    little ? data.writeUInt32LE(value, offset) : data.writeUInt32BE(value, offset);
  const write64 = (value, offset) =>
    little
      ? data.writeBigUInt64LE(BigInt(value), offset)
      : data.writeBigUInt64BE(BigInt(value), offset);
  write(wide ? 0xcafebabf : 0xcafebabe, 0);
  write(2, 4);
  for (let index = 0; index < slices.length; index += 1) {
    const record = 8 + index * recordSize;
    write(slices[index].data.readUInt32LE(4), record);
    write(0, record + 4);
    if (wide) {
      write64(starts[index], record + 8);
      write64(slices[index].data.length, record + 16);
    } else {
      write(starts[index], record + 8);
      write(slices[index].data.length, record + 12);
    }
    write(8, record + (wide ? 24 : 16));
    slices[index].data.copy(data, starts[index]);
  }
  return { data, offsets: slices.map((slice, index) => starts[index] + slice.offset) };
}

/**
 * Asserts that the rewrite changed the 16 UUID bytes at each offset and nothing else, and that each new UUID is
 * marked as version 8 with the standard variant.
 */
function assertOnlyUuidsChanged(before, result, offsets) {
  assert.equal(result.data.length, before.length);
  assert.deepEqual(
    result.changes.map((change) => change.offset),
    offsets,
  );
  for (let index = 0; index < before.length; index += 1) {
    if (!offsets.some((offset) => index >= offset && index < offset + 16))
      assert.equal(result.data[index], before[index], `byte ${index}`);
  }
  for (const offset of offsets) {
    assert.notDeepEqual(
      result.data.subarray(offset, offset + 16),
      before.subarray(offset, offset + 16),
    );
    assert.equal(result.data[offset + 6] >> 4, 8);
    assert.equal(result.data[offset + 8] >> 6, 2);
  }
}

test('changes only LC_UUID bytes for little/big endian 32/64-bit executables', () => {
  for (const little of [true, false])
    for (const wide of [true, false]) {
      const fixture = thin({ little, wide });
      const original = Buffer.from(fixture.data);
      assertOnlyUuidsChanged(fixture.data, rewriteMachOUuids(fixture.data, appId), [
        fixture.offset,
      ]);
      assert.deepEqual(fixture.data, original);
    }
});

test('is deterministic per original executable and distinguishes application, CPU, and upstream UUID', () => {
  const fixture = thin();
  const first = rewriteMachOUuids(fixture.data, appId);
  assert.deepEqual(first.data, rewriteMachOUuids(fixture.data, appId).data);
  for (const [data, id] of [
    [fixture.data, 'local.another.desktop'],
    [thin({ cpu: 0x01000007 }).data, appId],
    [thin({ uuid: Buffer.alloc(16, 0x43) }).data, appId],
  ])
    assert.notDeepEqual(
      first.changes[0].replacement,
      rewriteMachOUuids(data, id).changes[0].replacement,
    );
});

test('patches every universal slice, leaving the fat table and signature data unchanged', () => {
  for (const little of [true, false])
    for (const wide of [true, false]) {
      const fixture = fat({ little, wide });
      const result = rewriteMachOUuids(fixture.data, appId);
      assertOnlyUuidsChanged(fixture.data, result, fixture.offsets);
      assert.notDeepEqual(result.changes[0].replacement, result.changes[1].replacement);
    }
});

test('rejects truncated, non-executable, missing/duplicate UUID, and malformed load commands without mutation', () => {
  const cases = [Buffer.alloc(0), Buffer.alloc(16), thin().data.subarray(0, 40)];
  const badField = (offset, value) => {
    const data = thin().data;
    data.writeUInt32LE(value, offset);
    cases.push(data);
  };
  badField(12, 6); // dylib
  badField(16, 4097); // too many load commands
  badField(20, 10000); // load commands larger than the file
  badField(32, 0x99); // no UUID
  badField(36, 4); // LC_UUID shorter than a load command's own type and length
  badField(36, 1000); // LC_UUID running past the load commands
  badField(56, 0x1b); // duplicate UUID
  badField(60, 12); // load-command lengths disagree with sizeofcmds
  for (const data of cases) {
    const original = Buffer.from(data);
    assert.throws(() => rewriteMachOUuids(data, appId), /Mach-O/);
    assert.deepEqual(data, original);
  }
});

test('rejects unsafe, overlapping, mismatched, and malformed fat slices before patching', () => {
  const cases = [];
  const badField = (offset, value) => {
    const data = fat().data;
    data.writeUInt32BE(value, offset);
    cases.push(data);
  };
  badField(4, 65); // too many slices
  badField(16, 1); // slice inside the architecture table
  badField(20, 10000); // first slice running past the end of the file
  badField(36, 256); // overlapping second slice
  badField(28, 0x01000007); // architecture table disagrees with second slice
  // The second slice is a dylib.
  const invalidLast = fat().data;
  invalidLast.writeUInt32LE(6, 512 + 12);
  cases.push(invalidLast);
  // The first slice's 64-bit offset is too large for a JavaScript number to hold exactly.
  const unsafe64 = fat({ wide: true }).data;
  unsafe64.writeBigUInt64BE(0xffffffffffffffffn, 16);
  cases.push(unsafe64);
  for (const data of cases) {
    const original = Buffer.from(data);
    assert.throws(() => rewriteMachOUuids(data, appId), /Mach-O/);
    assert.deepEqual(data, original);
  }
});

test('requires an explicit bounded application identifier', () => {
  for (const id of [undefined, '', '../app', 'app\0other', 'a'.repeat(256)]) {
    assert.throws(() => rewriteMachOUuids(thin().data, id), /application identifier/);
  }
});
