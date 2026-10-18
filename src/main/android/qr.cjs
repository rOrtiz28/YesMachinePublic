'use strict';
// A small QR code encoder for the Wi-Fi pairing code that Android's wireless debugging scans: byte mode, error
// correction level M, versions 1 to 10, following ISO/IEC 18004. It returns the modules as rows of booleans
// (true is dark), which the page draws as pixels.
//
// main.cjs encodes the text of a pairing (advanced-mode.cjs's pair()) and sends the modules to the main window. The
// steps of encode(), in order: the text becomes data codewords, each block of them gets Reed-Solomon error
// correction, and the blocks are interleaved; the fixed patterns go in place, the codewords fill the rest in a
// zigzag, and of the eight masks the one that reads best is kept, with the format information that names it.

// --- Tables for level M ---

// Level M: error correction codewords per block, then [blocks, data codewords per block] for each group. By version.
const BLOCKS = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];
// The rows and columns of the alignment patterns' centers, by version.
const ALIGNMENT = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];
const LEVEL_M = 0b00; // the error correction level's two bits in the format information

// --- Reed-Solomon error correction ---

// Arithmetic in GF(256) over x^8 + x^4 + x^3 + x^2 + 1. EXP[i] is α^i, where α is the field element 2, and LOG is
// its inverse. EXP is twice as long as needed, so multiply can add two logarithms without wrapping them.
const EXP = new Uint8Array(512),
  LOG = new Uint8Array(256);
for (let i = 0, power = 1; i < 255; i++) {
  EXP[i] = power;
  LOG[power] = i;
  power <<= 1;
  if (power & 0x100) power ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const multiply = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/**
 * Reed-Solomon error correction codewords for one block of data: the remainder of the data, shifted by count
 * codewords, divided by the generator polynomial (x - α^0)(x - α^1)...(x - α^(count - 1)).
 */
function errorCorrection(data, count) {
  let generator = [1];
  for (let i = 0; i < count; i++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      next[j] ^= generator[j];
      next[j + 1] ^= multiply(generator[j], EXP[i]);
    }
    generator = next;
  }
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let j = 0; j < count; j++) remainder[j] ^= multiply(generator[j + 1], factor);
  }
  return remainder;
}

// --- Codewords ---

// How many data codewords a version holds at level M.
const dataCapacity = (version) =>
  BLOCKS[version].slice(1).reduce((sum, [count, size]) => sum + count * size, 0);

/**
 * The smallest version that holds the bytes in byte mode: a 4-bit mode, the count of bytes (8 bits up to version 9,
 * 16 from version 10) and 8 bits for each byte. Throws when even version 10 is too small.
 */
function versionFor(length) {
  for (let version = 1; version <= 10; version++) {
    if (4 + (version < 10 ? 8 : 16) + 8 * length <= 8 * dataCapacity(version)) return version;
  }
  throw Error('That text is too long for a QR code here.');
}

/** The final sequence of codewords: the data in blocks, then each block's error correction, interleaved. */
function codewords(bytes, version) {
  const [ec, ...groups] = BLOCKS[version],
    capacity = dataCapacity(version),
    bits = [];
  // Appends the lowest length bits of value, most significant first.
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  // Byte mode, the count of bytes, the bytes, and a terminator of up to four zero bits, as room allows; then zeros
  // to the end of the last byte.
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  // The pad bytes 0xEC and 0x11, in turn, fill the rest.
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  // The data splits into blocks, group by group, and each block gets its own error correction.
  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++, offset += size) {
      const block = data.slice(offset, offset + size);
      blocks.push({ data: block, ec: errorCorrection(block, ec) });
    }
  }
  // Interleaved: the first codeword of every block, then the second, and so on (the second group's blocks are one
  // longer), and then the error correction codewords the same way.
  const result = [];
  for (let i = 0; i < Math.max(...blocks.map((block) => block.data.length)); i++)
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  for (let i = 0; i < ec; i++) for (const block of blocks) result.push(block.ec[i]);
  return result;
}

// --- Format and version information ---

/**
 * BCH codes for the format (15 bits, masked) and version (18 bits) information. Returns value followed by length
 * check bits: the remainder of value, shifted left by length bits, divided by generator, as polynomials over GF(2).
 */
function bch(value, length, generator) {
  let remainder = value << length;
  const top = Math.floor(Math.log2(generator));
  for (let bit = Math.floor(Math.log2(remainder || 1)); bit >= top; bit--)
    if (remainder & (1 << bit)) remainder ^= generator << (bit - top);
  return (value << length) | remainder;
}
// The format information for a mask: level M and the mask number, with 10 check bits, then XORed with 0x5412.
const formatBits = (mask) => bch((LEVEL_M << 3) | mask, 10, 0x537) ^ 0x5412;
// The version information, for versions 7 and up: the version number with 12 check bits.
const versionBits = (version) => bch(version, 12, 0x1f25);

// --- Masks ---

// The eight mask patterns. A data module in column x and row y changes color where its mask is true.
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * How hard a pattern is to read: long runs, 2 x 2 blocks, finder look-alikes and an uneven balance of dark modules.
 * Scored as the standard says: each run of five or more modules of one color in a row or column scores 3, plus 1 for
 * each module past five; each finder look-alike (1:1:3:1:1 beside four light modules) 40; each 2 x 2 block of one
 * color 3; and 10 for every full 5% the dark modules are away from half.
 */
function penalty(modules) {
  // Every row and every column.
  const size = modules.length,
    lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(modules[i]);
    lines.push(modules.map((row) => row[i]));
  }
  let score = 0;
  for (const line of lines) {
    for (let start = 0; start < size;) {
      let end = start;
      while (end < size && line[end] === line[start]) end++;
      if (end - start >= 5) score += 3 + (end - start - 5);
      start = end;
    }
    const text = line.map((dark) => (dark ? '1' : '0')).join('');
    for (const pattern of ['10111010000', '00001011101'])
      for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1))
        score += 40;
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const color = modules[y][x];
      if (
        modules[y][x + 1] === color &&
        modules[y + 1][x] === color &&
        modules[y + 1][x + 1] === color
      )
        score += 3;
    }
  }
  const dark = modules.flat().filter(Boolean).length,
    total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

// --- The symbol ---

/**
 * Encodes text, as UTF-8, in the smallest version that holds it. Returns size rows of size booleans (true is dark),
 * where size is 17 + 4 * version (21 for version 1), without the light margin around them. Throws when the text is
 * too long.
 */
function encode(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')],
    version = versionFor(bytes.length),
    size = 17 + 4 * version;
  // modules holds the colors, and reserved marks the fixed patterns and the format and version information, which
  // the data and the masks leave alone.
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  // Finder patterns with their light separators, timing lines, alignment patterns and the always-dark module.
  // Each finder is a dark 7 x 7 ring, a light ring and a dark 3 x 3 center, inside its light separator (ring 4),
  // which the symbol's edge cuts off.
  for (const [centerX, centerY] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = centerX + dx,
          y = centerY + dy,
          ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  // The timing lines alternate along row 6 and column 6, between the finders.
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  // An alignment pattern (a dark 5 x 5 ring, a light ring, a dark center) at each pair of centers, except the three
  // corners the finders take.
  const centers = ALIGNMENT[version],
    last = centers.length - 1;
  centers.forEach((centerY, row) =>
    centers.forEach((centerX, column) => {
      if (
        (row === 0 && column === 0) ||
        (row === 0 && column === last) ||
        (row === last && column === 0)
      )
        return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  // The always-dark module, beside the bottom-left finder.
  set(8, size - 8, true);
  // Space for the format information, written after the mask is chosen, and the version information. The format
  // information goes along row 8 and column 8 beside the top-left finder, and once more split between the other two
  // finders.
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = reserved[size - 1 - i][8] = true;
  }
  // From version 7, the version information fills two 6 x 3 blocks, left of the top-right finder and above the
  // bottom-left one, with the same bits mirrored across the diagonal.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1,
        a = size - 11 + (i % 3),
        b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // The codewords, two columns at a time in a zigzag from the bottom right, skipping the timing column. The pairs of
  // columns go up and down in turn, past the reserved modules. The few modules left over after the data stay light
  // until the mask, like the standard's remainder bits.
  const bits = codewords(bytes, version).flatMap((byte) =>
    [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => ((byte >>> shift) & 1) === 1),
  );
  let next = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          upward = ((right + 1) & 2) === 0,
          y = upward ? size - 1 - step : step;
        if (!reserved[y][x] && next < bits.length) modules[y][x] = bits[next++];
      }
    }
  }

  // A copy of the symbol with a mask on everything but the reserved modules, and that mask's format information in
  // both of its places.
  const withMask = (mask) => {
    const masked = modules.map((row, y) =>
      row.map((dark, x) => (reserved[y][x] ? dark : dark !== MASKS[mask](x, y))),
    );
    const format = formatBits(mask),
      bit = (i) => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) masked[i][8] = bit(i);
    masked[7][8] = bit(6);
    masked[8][8] = bit(7);
    masked[8][7] = bit(8);
    for (let i = 9; i < 15; i++) masked[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) masked[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) masked[size - 15 + i][8] = bit(i);
    masked[size - 8][8] = true; // the always-dark module
    return masked;
  };
  // Every mask is tried, and the one with the lowest penalty is kept (the first of them, on a tie).
  let best = null,
    bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = withMask(mask),
      score = penalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

module.exports = { encode, errorCorrection, formatBits, versionBits, versionFor };
