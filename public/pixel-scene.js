'use strict';
// Sarigüeya, the app's cat, and the night rooftop scene she was first drawn for: she sits on a
// ledge watching the city, where windows go on and off, stars twinkle and a meteor crosses now and
// then. The Know the rooftop cat page shows this scene (the main window's
// src/windows/host/common.js and the Android app's home/common.js mount it). Most of the file is the cat
// herself, which the other scenes borrow: her sprites (catPixels), her colors (PALETTE by night,
// CREAM by day) and her behavior (Cat). The night house (pixel-house.js), the day house
// (pixel-day.js), the walk between them (pixel-home.js) and the browser viewer's napping cat
// (client/cats.js) all draw her with these.
//
// The art lives in code at its native resolution (200×76 art pixels for this scene), and render()
// fills a plain RGBA buffer, so the same frames can be drawn on a canvas or exported as PNGs for
// Android. Scale it only by whole device pixels, so each art pixel stays square and sharp. Pages
// load the file as a plain script (window.PixelScene); Node tests require() it.
//
// Animation goes in ticks of TICK milliseconds, eight a second. The city is drawn from a fixed
// seed, so it is the same every time; the animation's chances come from the scene's own seed.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelScene = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // --- Size, timing and colors ---

  // The scene's size in art pixels, the tick's length in ms, the cat's top-left corner (her feet
  // rest on the middle ledge, at row CAT_Y + 22) and her moods.
  const W = 200,
    H = 76,
    TICK = 125,
    CAT_X = 74,
    CAT_Y = 40,
    MOODS = ['sleep', 'awake', 'happy', 'nap'];
  // Night colors, by name. By night the cat is drawn in lines: a near-black body (catFill) with a
  // pale outline (catLine), and mint eyes and hearts, like the lit windows.
  const PALETTE = {
    star: '#7b8794',
    starDim: '#46515c',
    glow: '#c5ced3',
    catLine: '#aab1b5',
    catDim: '#59636a',
    catDetail: '#323b41',
    catFill: '#0f1418',
    catShade: '#161d22',
    eye: '#8feba7',
    building: '#151c22',
    buildingTop: '#202930',
    windowOn: '#5ba975',
    windowBright: '#8feba7',
    windowDim: '#3b674a',
    windowOff: '#1a222a',
    hill: '#11171c',
    hillSpeck: '#1c232a',
    ledgeLine: '#5c676d',
    ledgeShine: '#8a958f',
    ledgeFace: '#171d22',
    ledgeShadow: '#0e1317',
    ledgeEdge: '#252d33',
    heart: '#8feba7',
  };
  // Sarigüeya by day, for light mode: cream with a brown outline, and pink hearts. The day house
  // (pixel-day.js) and the viewer's napping cat both draw her in these. The star, glow and window
  // colors are the ones her hearts and z's fade through by day.
  const CREAM = {
    catFill: '#f2ddb9',
    catShade: '#e0c296',
    catLine: '#7b5b3d',
    catDim: '#a98560',
    catDetail: '#cfa676',
    eye: '#4f9a5c',
    nose: '#dc9a96',
    heart: '#e0607e',
    glow: '#ffffff',
    star: '#b9c6d2',
    starDim: '#d8e1ea',
    windowDim: '#e9a6b6',
  };

  // --- The cat's sprite ---

  // Her body is 18 pixels wide (columns 0 to 17), her tail reaches past it on the right, and her
  // feet rest on row 22. Shapes are written as rows of characters, one per pixel: '#' is solid
  // (outlined automatically where it meets the air), 'o' outline, 'd' dim line, 'h' faint detail,
  // 's' shade, 'e' eye and '.' nothing. A cell is [x, y, mark], where mark is one of those.

  /** Turns rows of characters into cells, the first row at y0 and the first column at x0. */
  const cells = (x0, y0, rows) =>
    rows.flatMap((row, y) =>
      [...row].flatMap((mark, x) => (mark === '.' ? [] : [[x0 + x, y0 + y, mark]])),
    );
  /** Turns a [from, to] range of columns per row, starting at row y0, into solid cells. */
  const spans = (y0, rows) =>
    rows.flatMap(([from, to], row) =>
      Array.from({ length: to - from + 1 }, (_, offset) => [from + offset, y0 + row, '#']),
    );
  /** Mirrors cells left to right across her body: column x becomes 17 - x. */
  const mirror = (list) => list.map(([x, y, mark]) => [17 - x, y, mark]);
  // Her head, as a range of columns per row.
  const HEAD = [
    [3, 14],
    [2, 15],
    [2, 15],
    [2, 15],
    [3, 14],
    [4, 13],
  ];
  // Her body sitting up, widest at the haunches.
  const BODY = [
    [3, 14],
    [2, 15],
    [2, 15],
    [1, 16],
    [1, 16],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [1, 16],
  ];
  // Her body curled up in a loaf, rounder and lower.
  const DOME = [
    [1, 16],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [0, 17],
    [1, 16],
  ];
  // In the loaf, a dim line where her head meets her back.
  const BACK = cells(3, 12, ['dddddddddddd']);
  // Sitting, faint lines that mark her hind legs.
  const HAUNCHES = cells(5, 16, ['.h....h.', 'h......h', 'h......h', 'h......h', 'h......h']);
  // Each pose: the row where her head starts (her ears go above it) and its cells. She sits up;
  // she crouches lower on her way to or from sleep; she sleeps in a loaf, which breathes between
  // loaf and loafLow; and she lies down to nap.
  const POSES = {
    sit: { head: 4, cells: [...spans(4, HEAD), ...spans(10, BODY), ...HAUNCHES] },
    crouch: { head: 6, cells: [...spans(6, HEAD.slice(0, 5)), ...spans(10, BODY), ...HAUNCHES] },
    loaf: { head: 8, cells: [...spans(8, HEAD.slice(0, 4)), ...spans(12, DOME), ...BACK] },
    loafLow: { head: 9, cells: [...spans(9, HEAD.slice(0, 3)), ...spans(12, DOME), ...BACK] },
    // Lying down and facing the viewer, with the jaw line over the chest and two front paws.
    lie: {
      head: 8,
      cells: [
        ...spans(8, HEAD.slice(0, 5)),
        ...spans(12, DOME),
        ...cells(4, 13, ['dddddddddd']),
        ...cells(5, 20, ['hh....hh']),
      ],
    },
  };
  // The ear on the left of the picture, top row first, its last row resting on her head (the
  // other ear is its mirror): up, perked taller when she's happy, or resting, folded down.
  const EARS = {
    up: ['#..', '##.', '###'],
    perk: ['#..', '#..', '##.', '###'],
    rest: ['##.', '###'],
  };
  // An ear flicked out sideways for a moment.
  const FLICK = ['##..', '.###'];
  /**
   * Builds a tail that starts on the ground at the right of her body, curves out to column 22 and
   * rises along it to row y0. The rows in top shape its tip, starting at row y0.
   */
  const tail = (y0, top) =>
    cells(16, y0, [
      ...top,
      ...Array(18 - y0 - top.length).fill('......#.'),
      '.....#..',
      '....#...',
      '..##....',
      '##......',
    ]);
  // Her tails: the tip curled over, straight up, the tip tilted out, the two sides of a wag
  // (leaning in, then out), wrapped along the ground while she sleeps, the same with its tip down
  // (it twitches), and none, for the viewer's napping cat, whose tail client/cats.js draws hanging.
  const TAILS = {
    curl: tail(11, ['....##..', '...#..#.']),
    up: tail(10, []),
    tilt: tail(11, ['.......#']),
    wagL: tail(8, ['....#...', '.....#..', '.....#..']),
    wagR: tail(8, ['.......#', '.......#']),
    wrap: cells(16, 19, ['.......#', '.......#', '.######.']),
    wrapFlat: cells(16, 21, ['.#######']),
    none: [],
  };
  // Her face. With no face we see her from behind, as she watches the city; a face turns her head
  // to the viewer, with the inside of her ears ('d' at the top), her eyes and her nose. Eyes open,
  // shut in a blink, or squeezed happy; then lower down, for lying, asleep or peeking.
  const FACES = {
    look: cells(4, 3, ['d........d', '', '', '.ee....ee.', '.ee....ee.', '....dd....']),
    blink: cells(4, 3, ['d........d', '', '', '', '.oo....oo.', '....dd....']),
    happy: cells(4, 3, ['d........d', '', '', '.e......e.', 'e.e....e.e', '....dd....']),
    lieSleep: cells(4, 7, ['d........d', '', '', '.oo....oo.', '....dd....']),
    liePeek: cells(4, 7, ['d........d', '', '.ee....ee.', '.ee....ee.', '....dd....']),
  };

  /**
   * Builds one picture of the cat as a list of [x, y, colorName] pixels, with her top-left corner
   * at 0, 0 and her feet resting on row 22. The color names are PALETTE's: catLine (her outline),
   * catDim, catDetail, catShade, catFill and eye.
   * @param pose a key of POSES.
   * @param earKind a key of EARS.
   * @param flick 'L' or 'R' for the ear she is flicking, or null.
   * @param tailKind a key of TAILS.
   * @param face a key of FACES, or null for none.
   */
  function catPixels(pose, earKind, flick, tailKind, face) {
    const { head, cells: body } = POSES[pose],
      ear = EARS[earKind];
    // The cells of one ear, standing on the head or flicked out.
    const side = (earSide) =>
      flick === earSide ? cells(2, head - 2, FLICK) : cells(3, head - ear.length, ear);
    // Pixels are keyed by y * 32 + x, so the four neighbors of a key are key ± 1 and key ± 32. A
    // detail always takes its pixel, but a plain '#' only fills an empty one.
    const grid = new Map();
    for (const [x, y, mark] of [
      ...body,
      ...side('L'),
      ...mirror(side('R')),
      ...TAILS[tailKind],
      ...(face ? FACES[face] : []),
    ])
      if (mark !== '#' || !grid.has(y * 32 + x)) grid.set(y * 32 + x, mark);
    return [...grid].map(([key, mark]) => {
      // Any pixel next to empty space is outline, except at the bottom: row 22 is the ledge, which
      // outlines the base.
      const edge = [key - 1, key + 1, key - 32, key + 32].some(
        (neighbor) => neighbor < 22 * 32 && !grid.has(neighbor),
      );
      return [
        key % 32,
        (key / 32) | 0,
        mark === 'e'
          ? 'eye'
          : edge || mark === 'o'
            ? 'catLine'
            : mark === 'd'
              ? 'catDim'
              : mark === 'h'
                ? 'catDetail'
                : mark === 's'
                  ? 'catShade'
                  : 'catFill',
      ];
    });
  }

  // --- The rooftop's layout, in art pixels ---

  // A 4×4 ordered-dither (Bayer) matrix: a threshold from 0 to 15 for each pixel of a 4×4 block,
  // arranged so that the pixels under any threshold are spread evenly over the block.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  // The hill at the left: from each x on, its top row.
  const HILL = [
    [0, 71],
    [7, 69],
    [13, 67],
    [19, 66],
    [38, 65],
    [46, 64],
  ];
  // The flat roofs in front of the city, each a top line from x0 to x1 at row y with its face
  // below: one behind at the right, the cat's in the middle, and a lower one in front at the right.
  const LEDGES = [
    { x0: 140, x1: 199, y: 57 },
    { x0: 58, x1: 152, y: 62 },
    { x0: 153, x1: 199, y: 67 },
  ];
  // The city's buildings: the left edge, top row and width; the columns and rows of their 2×2
  // windows; an antenna ([x, height]) with a blinking light on top if light is set; a box on the
  // roof ([x, y, width, height]); and ears, for the building shaped like a cat, whose top windows
  // are its eyes.
  const BUILDINGS = [
    { x: 10, y: 57, w: 6, cols: [12], rows: [59, 62] },
    { x: 18, y: 48, w: 7, cols: [19, 22], rows: [50, 53, 56, 59, 62] },
    { x: 28, y: 45, w: 7, cols: [29, 32], rows: [47, 50, 53, 56, 59, 62], antenna: [31, 3] },
    { x: 159, y: 46, w: 10, cols: [161, 165], rows: [49, 53], ears: true },
    {
      x: 178,
      y: 27,
      w: 14,
      cols: [180, 184, 188],
      rows: [30, 34, 38, 42, 46, 50],
      antenna: [184, 6],
      light: true,
      box: [186, 24, 4, 3],
    },
    { x: 194, y: 37, w: 8, cols: [196], rows: [40, 44, 48] },
  ];
  // Stars as [x, y, level]: level 0 is a dim point, 2 a bright one with a cross around it.
  const STARS = [
    [56, 22, 2],
    [90, 9, 2],
    [22, 14, 0],
    [118, 5, 0],
    [137, 27, 0],
    [38, 36, 0],
    [106, 30, 0],
    [72, 33, 0],
    [8, 30, 0],
    [150, 12, 0],
  ];
  // What floats up from the cat: a small z that grows into a big Z while she sleeps, and a heart.
  const GLYPHS = {
    z: ['###', '.#.', '#..', '###'],
    Z: ['####', '..#.', '.#..', '#...', '####'],
    heart: ['.#.#.', '#####', '.###.', '..#..'],
  };

  // --- Helpers ---

  /** Turns '#rrggbb' into [r, g, b, 255], ready to set into an RGBA buffer. */
  const rgba = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255, 255];
  };
  /**
   * mulberry32, a small 32-bit random number generator: the same seed always gives the same
   * numbers. Returns a function that gives the next number, from 0 up to but not including 1.
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- The cat's behavior ---

  /**
   * The cat's behavior, shared by every scene that draws her: her mood, and what she does in it,
   * one tick at a time. Moods: 'sleep' (curled up in a loaf, z's rising), 'awake' (sitting, her
   * tail moving through its shapes, now and then turning to look at the viewer), 'happy' (ears
   * perked, tail wagging) and 'nap' (lying down facing the viewer, now and then peeking). The z's
   * and hearts that float up are placed relative to the sprite's top-left corner, so a scene only
   * decides where the cat sits.
   */
  class Cat {
    /**
     * @param random a generator from mulberry32.
     * @param mood her first mood; an unknown one is 'awake'.
     */
    constructor(random, mood = 'awake') {
      this.random = random;
      this.mood = MOODS.includes(mood) ? mood : 'awake';
      this.t = 0; // ticks so far
      this.particles = []; // z's and hearts floating up: { kind, x, y, age }
      this.sprites = new Map(); // pictures already built, by state
      // Timers, in ticks: how long an ear flick lasts and when the next comes, when she next
      // looks, how long the crouch between sleep and waking lasts, and when the next z comes.
      this.flickTicks = 0;
      this.nextFlick = 60;
      this.nextLook = 90;
      this.transition = 0;
      this.nextZ = 4;
      this.lookNow = false; // look() asked her to look at once
      // After a tap: the happy ticks left, and the mood to go back to.
      this.petTicks = 0;
      this.petReturn = null;
      this.reset();
    }

    /**
     * Starts her mood afresh: its usual tail, held for `hold` ticks (step is her place in the
     * awake tail's cycle), and no face or ear flick.
     */
    reset() {
      this.tail =
        this.mood === 'sleep'
          ? 'wrap'
          : this.mood === 'happy'
            ? 'wagL'
            : this.mood === 'nap'
              ? 'none'
              : 'curl';
      this.hold = 6;
      this.step = 0;
      this.face = null;
      this.faceTicks = 0;
      this.flick = null;
      this.flickTicks = 0;
    }

    /**
     * Changes her mood. Any mood set here, even the one she has, ends a tap's happy spell. Going to
     * sleep or waking up shows a short crouch first; turning happy sends a heart up over her head;
     * waking clears the z's.
     */
    setMood(mood) {
      if (!MOODS.includes(mood)) return;
      this.petTicks = 0;
      if (mood === this.mood) return;
      this.transition = this.mood === 'sleep' || mood === 'sleep' ? 2 : 0;
      this.mood = mood;
      this.reset();
      if (mood === 'happy') this.particles.push({ kind: 'heart', x: 6, y: -5, age: 0 });
      if (mood !== 'sleep')
        this.particles = this.particles.filter((particle) => particle.kind !== 'z');
    }

    /** Has her look at once: sitting, she turns to the viewer; napping, she peeks. Not asleep. */
    look() {
      if (this.mood !== 'sleep') this.lookNow = true;
    }

    /**
     * A tap on the cat: a heart beside her ear, where a low sky still has room for it to rise, and
     * a few happy seconds (32 ticks) before she returns to her mood. A mood set meanwhile wins.
     */
    pet() {
      if (this.mood !== 'happy') {
        const before = this.mood;
        this.setMood('happy');
        // Turning happy sent a heart over her head; only the one by her ear should rise.
        this.particles = this.particles.filter(
          (particle) => particle.kind !== 'heart' || particle.age > 0,
        );
        this.petReturn = before;
        this.petTicks = 32;
      } else if (this.petTicks) this.petTicks = 32; // another tap restarts the happy spell
      this.particles.push({ kind: 'heart', x: 19, y: 3, age: 0 });
    }

    /** Moves her on one tick: what floats up rises and fades, and her mood's animation goes on. */
    tick() {
      const random = this.random;
      this.t++;
      if (this.petTicks && --this.petTicks === 0) this.setMood(this.petReturn);
      // z's and hearts rise a pixel every 2 ticks, and z's drift right every 5. z's last 30 ticks
      // and hearts 24.
      for (const particle of this.particles) {
        particle.age++;
        if (particle.age % 2 === 0) particle.y--;
        if (particle.kind === 'z' && particle.age % 5 === 0) particle.x++;
      }
      this.particles = this.particles.filter(
        (particle) => particle.age < (particle.kind === 'z' ? 30 : 24),
      );
      // On her way to or from sleep she holds the crouch.
      if (this.transition) {
        this.transition--;
        return;
      }
      if (this.mood === 'nap') {
        // Dozing on top of something. An ear flicks every 60 to 180 ticks, and every 80 to 200 she
        // opens her eyes for 18 to 28 ticks, with a blink along the way.
        if (this.flickTicks && --this.flickTicks === 0) this.flick = null;
        if (--this.nextFlick <= 0) {
          this.flick = random() < 0.5 ? 'L' : 'R';
          this.flickTicks = 2;
          this.nextFlick = (60 + random() * 120) | 0;
        }
        if (this.faceTicks) {
          this.faceTicks--;
          this.face = !this.faceTicks ? null : this.faceTicks === 8 ? 'lieSleep' : 'liePeek';
        } else if (--this.nextLook <= 0 || this.lookNow) {
          this.lookNow = false;
          this.faceTicks = (18 + random() * 10) | 0;
          this.face = 'liePeek';
          this.nextLook = (80 + random() * 120) | 0;
        }
        return;
      }
      if (this.mood === 'sleep') {
        // A z every 14 to 24 ticks. The tip of her wrapped tail twitches: wrap for 30 to 80
        // ticks, then wrapFlat for 3.
        if (--this.nextZ <= 0) {
          this.particles.push({ kind: 'z', x: 14, y: 3, age: 0 });
          this.nextZ = (14 + random() * 10) | 0;
        }
        if (--this.hold <= 0) {
          this.tail = this.tail === 'wrap' ? 'wrapFlat' : 'wrap';
          this.hold = this.tail === 'wrap' ? (30 + random() * 50) | 0 : 3;
        }
        return;
      }
      // Awake or happy: an ear flicks for 2 ticks every 40 to 120.
      if (this.flickTicks && --this.flickTicks === 0) this.flick = null;
      if (--this.nextFlick <= 0) {
        this.flick = random() < 0.5 ? 'L' : 'R';
        this.flickTicks = 2;
        this.nextFlick = (40 + random() * 80) | 0;
      }
      // Happy, her tail wags every 2 ticks. Awake, it goes curl, up, tilt, up and back to curl,
      // holding curl for 6 to 22 ticks and each other shape for 2 to 5.
      if (this.mood === 'happy') {
        if (this.t % 2 === 0) this.tail = this.tail === 'wagL' ? 'wagR' : 'wagL';
      } else if (--this.hold <= 0) {
        this.step = (this.step + 1) % 4;
        this.tail = ['curl', 'up', 'tilt', 'up'][this.step];
        this.hold = this.tail === 'curl' ? (6 + random() * 16) | 0 : (2 + random() * 3) | 0;
      }
      // Every 90 to 200 ticks (50 to 160 when happy) she looks at the viewer for 20 to 30 ticks,
      // blinking once along the way unless she's happy.
      if (this.faceTicks) {
        this.faceTicks--;
        this.face = !this.faceTicks
          ? null
          : this.mood === 'happy'
            ? 'happy'
            : this.faceTicks === 9
              ? 'blink'
              : 'look';
      } else if (--this.nextLook <= 0 || this.lookNow) {
        this.lookNow = false;
        this.faceTicks = (20 + random() * 10) | 0;
        this.face = this.mood === 'happy' ? 'happy' : 'look';
        this.nextLook = ((this.mood === 'happy' ? 50 : 90) + random() * 110) | 0;
      }
    }

    /** What to draw now: { pose, ears, flick, tail, face }, the arguments of catPixels. */
    state() {
      // Napping: lying down, ears up while she peeks, eyes shut otherwise.
      if (this.mood === 'nap')
        return {
          pose: 'lie',
          ears: this.face === 'liePeek' ? 'up' : 'rest',
          flick: this.flick,
          tail: 'none',
          face: this.face || 'lieSleep',
        };
      // The crouch on her way to sleep (tail wrapped) or out of it (tail curled).
      if (this.transition)
        return {
          pose: 'crouch',
          ears: 'rest',
          flick: null,
          tail: this.mood === 'sleep' ? 'wrap' : 'curl',
          face: null,
        };
      // Asleep in a loaf that breathes, 12 ticks in and 12 out.
      if (this.mood === 'sleep')
        return {
          pose: this.t % 24 < 12 ? 'loaf' : 'loafLow',
          ears: 'rest',
          flick: null,
          tail: this.tail,
          face: null,
        };
      return {
        pose: 'sit',
        ears: this.mood === 'happy' ? 'perk' : 'up',
        flick: this.flick,
        tail: this.tail,
        face: this.face,
      };
    }

    /**
     * Draws the sprite with its feet resting on row y0 + 22, plus its floating z's or heart.
     * @param put plots one pixel: put(x, y, rgba).
     * @param x0 the sprite's left column.
     * @param y0 the sprite's top row.
     * @param c the colors by name, as RGBA.
     */
    draw(put, x0, y0, c) {
      const { pose, ears, flick, tail: tailKind, face } = this.state(),
        key = [pose, ears, flick, tailKind, face].join();
      // Each picture is built once and kept, since a mood uses only a few.
      if (!this.sprites.has(key))
        this.sprites.set(key, catPixels(pose, ears, flick, tailKind, face));
      for (const [x, y, col] of this.sprites.get(key)) put(x0 + x, y0 + y, c[col]);
      // Hearts fade from heart through windowDim to starDim; z's fade from glow through star to
      // starDim, and grow from a small z into a big Z after 10 ticks.
      for (const particle of this.particles) {
        const col =
          particle.kind === 'heart'
            ? particle.age < 14
              ? c.heart
              : particle.age < 19
                ? c.windowDim
                : c.starDim
            : particle.age < 18
              ? c.glow
              : particle.age < 25
                ? c.star
                : c.starDim;
        for (const [x, y] of cells(
          x0 + particle.x,
          y0 + particle.y,
          GLYPHS[particle.kind === 'z' ? (particle.age < 10 ? 'z' : 'Z') : 'heart'],
        ))
          put(x, y, col);
      }
    }
  }

  // --- The rooftop scene ---

  /**
   * The rooftop at night: buildings whose windows go on and off (one of them is shaped like a cat,
   * and its top windows are eyes that blink), a hill at the left, stars that twinkle, a meteor now
   * and then, and the cat on the middle ledge.
   * @param seed seeds the animation's chances (the time by default).
   * @param mood the cat's first mood.
   * @param palette colors to use instead of PALETTE's, by name, as '#rrggbb'.
   */
  class Scene {
    constructor({ seed = Date.now(), mood = 'awake', palette } = {}) {
      this.random = mulberry32(seed);
      this.color = Object.fromEntries(
        Object.entries({ ...PALETTE, ...palette }).map(([name, hex]) => [name, rgba(hex)]),
      );
      // What never moves, as RGBA, transparent where there is sky.
      this.base = new Uint8ClampedArray(W * H * 4);
      // 1 where the hill or a ledge covers a pixel, so that windows behind them stay hidden.
      this.cover = new Uint8Array(W * H);
      this.windows = []; // { x, y, eye, state }: state is 'On', 'Dim', 'Bright' or 'Off'
      this.lights = []; // the blinking lights on top of antennas: { x, y }
      this.t = 0;
      this.paintStatic();
      // Each star twinkles (boost) when its own countdown runs out.
      this.stars = STARS.map(([x, y, level]) => ({
        x,
        y,
        level,
        boost: 0,
        next: (10 + this.random() * 80) | 0,
      }));
      this.meteor = null;
      this.nextMeteor = (240 + this.random() * 480) | 0;
      this.nextWindow = 8;
      this.eyesShut = 0; // ticks left with the cat-shaped building's eyes shut
      this.nextEyes = 40;
      this.cat = new Cat(this.random, mood);
    }

    /** The cat's mood. */
    get mood() {
      return this.cat.mood;
    }

    /**
     * Draws what never moves into this.base and lists the windows and antenna lights. It uses its
     * own fixed seed, so the city is the same every time.
     */
    paintStatic() {
      const art = mulberry32(7),
        c = this.color;
      // Plots one static pixel; cover marks it as hiding any window behind it.
      const put = (x, y, col, cover) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        this.base.set(col, (y * W + x) * 4);
        if (cover) this.cover[y * W + x] = 1;
      };
      for (const building of BUILDINGS) {
        // The buildings at the right stand behind the ledges and stop above them; the others reach
        // the bottom, behind the hill. Their top row is lighter.
        const bottom = building.x >= 140 ? 56 : H - 1;
        for (let y = building.y; y <= bottom; y++)
          for (let x = building.x; x < building.x + building.w; x++)
            put(x, y, y === building.y ? c.buildingTop : c.building);
        // The cat-shaped building's two ears, one on each top corner.
        if (building.ears)
          for (const [x, y] of [
            [0, -2],
            [0, -1],
            [1, -1],
          ]) {
            put(building.x + x, building.y + y, c.buildingTop);
            put(building.x + building.w - 1 - x, building.y + y, c.buildingTop);
          }
        // An antenna, and the place of its blinking light just above it, if it has one.
        if (building.antenna) {
          const [x, height] = building.antenna;
          for (let y = building.y - height; y < building.y; y++) put(x, y, c.buildingTop);
          if (building.light) this.lights.push({ x, y: building.y - height - 1 });
        }
        // A box on the roof, its top row lighter.
        if (building.box) {
          const [x0, y0, w, h] = building.box;
          for (let y = y0; y < y0 + h; y++)
            for (let x = x0; x < x0 + w; x++) put(x, y, y === y0 ? c.buildingTop : c.building);
        }
        // The windows start out 45% on, 15% dim, 8% bright and the rest off. The cat-shaped
        // building's top row of windows are its eyes.
        building.rows.forEach((y, row) =>
          building.cols.forEach((x) => {
            const roll = art();
            this.windows.push({
              x,
              y,
              eye: !!building.ears && row === 0,
              state: roll < 0.45 ? 'On' : roll < 0.6 ? 'Dim' : roll < 0.68 ? 'Bright' : 'Off',
            });
          }),
        );
      }
      // The hill, its top stepping down as HILL says, with 8% lighter specks.
      for (let x = 0; x < 58; x++) {
        let top = H;
        for (const [from, y] of HILL) if (x >= from) top = y;
        for (let y = top; y < H; y++) {
          // Dither the hill into the sky at the left edge: in column x, pixels whose threshold is x
          // or more are left out, so it fades away to nothing at x 0.
          if (x < 16 && BAYER[(y & 3) * 4 + (x & 3)] >= x) continue;
          put(x, y, art() < 0.08 ? c.hillSpeck : c.hill, true);
        }
      }
      // Each ledge: its top line, a row of shadow under it, then its face down to the bottom, with
      // a lighter edge at its left end. Here and there the top line catches the light: a run of 2
      // to 5 shining pixels, then a gap.
      for (const { x0, x1, y } of LEDGES) {
        for (let x = x0; x <= x1; x++) {
          put(x, y, c.ledgeLine, true);
          put(x, y + 1, x === x0 ? c.ledgeEdge : c.ledgeShadow, true);
          for (let yy = y + 2; yy < H; yy++) put(x, yy, x === x0 ? c.ledgeEdge : c.ledgeFace, true);
        }
        for (let x = x0 + 2; x < x1; x++)
          if (art() < 0.07) {
            const run = (2 + art() * 4) | 0;
            for (let i = 0; i < run && x + i <= x1; i++) put(x + i, y, c.ledgeShine, true);
            x += run + 2;
          }
      }
    }

    setMood(mood) {
      this.cat.setMood(mood);
    }

    look() {
      this.cat.look();
    }

    /** Moves the scene on one tick. */
    tick() {
      const random = this.random;
      this.t++;
      // Every 5 to 19 ticks a window that isn't an eye changes: one that's off comes on (70%), or
      // else turns dim or bright; one that's lit goes off (60%) or dims.
      if (--this.nextWindow <= 0) {
        const pool = this.windows.filter((w) => !w.eye),
          w = pool[(random() * pool.length) | 0];
        w.state =
          w.state === 'Off'
            ? random() < 0.7
              ? 'On'
              : random() < 0.5
                ? 'Dim'
                : 'Bright'
            : random() < 0.6
              ? 'Off'
              : 'Dim';
        this.nextWindow = (5 + random() * 14) | 0;
      }
      // The cat-shaped building blinks: its eyes shut for a tick every 30 to 80.
      if (this.eyesShut) this.eyesShut--;
      else if (--this.nextEyes <= 0) {
        this.eyesShut = 1;
        this.nextEyes = (30 + random() * 50) | 0;
      }
      // Each star twinkles for 3 ticks every 30 to 120.
      for (const star of this.stars) {
        if (star.boost) star.boost--;
        else if (--star.next <= 0) {
          star.boost = 3;
          star.next = (30 + random() * 90) | 0;
        }
      }
      // A meteor falls from the top right, 6 pixels left and 2 down a tick, and is gone past x 40.
      // The next comes 480 to 960 ticks later (one or two minutes).
      if (this.meteor) {
        this.meteor.x -= 6;
        this.meteor.y += 2;
        if (this.meteor.x < 40) this.meteor = null;
      } else if (--this.nextMeteor <= 0) {
        this.meteor = { x: (130 + random() * 60) | 0, y: (1 + random() * 5) | 0 };
        this.nextMeteor = (480 + random() * 480) | 0;
      }
      this.cat.tick();
    }

    catState() {
      return this.cat.state();
    }

    /** Draws the current frame into out, an RGBA buffer of W × H pixels. */
    render(out) {
      out.set(this.base);
      const c = this.color;
      const put = (x, y, col) => {
        if (x >= 0 && y >= 0 && x < W && y < H) out.set(col, (y * W + x) * 4);
      };
      // Whether a pixel is open sky, where stars and the meteor may show.
      const sky = (x, y) =>
        x >= 0 && y >= 0 && x < W && y < H && this.base[(y * W + x) * 4 + 3] === 0;
      // The windows, 2×2, except where the hill or a ledge covers them. The eyes are shut, bright
      // while the cat is happy, or on.
      for (const w of this.windows) {
        const col = w.eye
          ? this.eyesShut
            ? c.windowOff
            : this.mood === 'happy'
              ? c.windowBright
              : c.windowOn
          : c['window' + w.state];
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++)
            if (!this.cover[(w.y + dy) * W + w.x + dx]) put(w.x + dx, w.y + dy, col);
      }
      // Antenna lights flash for 2 ticks in every 20.
      for (const light of this.lights)
        put(light.x, light.y, this.t % 20 < 2 ? c.windowBright : c.starDim);
      // A twinkle raises a star's level by one: 0 is dim, 1 and 2 normal, 3 glowing. From level 2
      // a star has a cross around it.
      for (const star of this.stars) {
        const level = Math.min(3, star.level + (star.boost ? 1 : 0));
        if (sky(star.x, star.y))
          put(star.x, star.y, level === 0 ? c.starDim : level === 3 ? c.glow : c.star);
        if (level >= 2)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            if (sky(star.x + dx, star.y + dy))
              put(star.x + dx, star.y + dy, level === 3 ? c.star : c.starDim);
      }
      // The meteor: a glowing head with a trail of 8 pixels that rises to the right behind it.
      if (this.meteor)
        for (let j = 0; j < 8; j++) {
          const x = this.meteor.x + j,
            y = this.meteor.y - Math.round(j / 3);
          if (sky(x, y)) put(x, y, j < 2 ? c.glow : j < 5 ? c.star : c.starDim);
        }
      this.cat.draw(put, CAT_X, CAT_Y, c);
    }
  }

  // --- Showing the scene on a page ---

  /**
   * Browser helper: shows the scene on a canvas, animated while the page is visible unless the
   * person prefers reduced motion. Tapping the cat gives a heart. Styles are set through the
   * CSSOM, which the app's style-src 'self' policy allows.
   * @param canvas the canvas to draw on.
   * @param options Scene's options, plus scale (CSS pixels per art pixel, 3 by default) and
   *   container (the element that listens for taps, the canvas by default).
   * @returns the scene and its controls: pet(), setMood(mood), look(), setScale(scale), pause(),
   *   resume() and destroy().
   */
  function mount(canvas, options = {}) {
    const scene = new Scene(options),
      ctx = canvas.getContext('2d'),
      image = ctx.createImageData(W, H);
    // The frame on the canvas and the one just drawn, as 32-bit pixels, so that a frame with no
    // change isn't put on the canvas again.
    const shown = new Uint32Array(W * H),
      next = new Uint32Array(image.data.buffer);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let scale = options.scale || 3,
      timer = 0,
      paused = false;
    canvas.width = W;
    canvas.height = H;
    canvas.style.imageRendering = 'pixelated';
    const fit = () => {
      // each art pixel must cover a whole number of device pixels
      const ratio = devicePixelRatio || 1,
        device = Math.max(1, Math.round(scale * ratio));
      canvas.style.width = (W * device) / ratio + 'px';
      canvas.style.height = (H * device) / ratio + 'px';
    };
    const draw = () => {
      scene.render(image.data);
      if (next.every((pixel, i) => pixel === shown[i])) return;
      shown.set(next);
      ctx.putImageData(image, 0, 0);
    };
    // The animation runs only while it isn't paused, the page is visible and motion isn't reduced.
    const sync = () => {
      clearInterval(timer);
      timer = 0;
      if (!paused && !document.hidden && !motion.matches)
        timer = setInterval(() => {
          scene.tick();
          draw();
        }, TICK);
    };
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    addEventListener('resize', fit);
    // Tapping the cat gives a heart. onCat says whether a pointer event is over her, a little
    // beyond her sprite, in art pixels.
    const target = options.container || canvas;
    const onCat = (event) => {
      const rect = canvas.getBoundingClientRect(),
        x = ((event.clientX - rect.left) * W) / rect.width,
        y = ((event.clientY - rect.top) * H) / rect.height;
      return x >= CAT_X - 2 && x < CAT_X + 26 && y >= CAT_Y - 2 && y < CAT_Y + 22;
    };
    const onClick = (event) => {
      if (onCat(event)) {
        scene.cat.pet();
        draw();
      }
    };
    const onMove = (event) => {
      target.style.cursor = onCat(event) ? 'pointer' : '';
    };
    target.addEventListener('click', onClick);
    target.addEventListener('pointermove', onMove);
    fit();
    draw();
    sync();
    return {
      scene,
      pet() {
        scene.cat.pet();
        draw();
      },
      setMood(mood) {
        scene.setMood(mood);
        draw();
      },
      look() {
        scene.look();
      },
      setScale(value) {
        scale = value;
        fit();
      },
      pause() {
        paused = true;
        sync();
      },
      resume() {
        paused = false;
        sync();
      },
      // Stops the animation and removes every listener.
      destroy() {
        paused = true;
        sync();
        document.removeEventListener('visibilitychange', sync);
        motion.removeEventListener('change', sync);
        removeEventListener('resize', fit);
        target.removeEventListener('click', onClick);
        target.removeEventListener('pointermove', onMove);
      },
    };
  }

  return { W, H, TICK, MOODS, PALETTE, CREAM, Scene, Cat, mount, catPixels, mulberry32 };
});
