'use strict';
// The house by day, for light mode, drawn from photos of Sarigüeya's real house. It keeps the
// night house's layout (pixel-house.js), so the page's windows stay put between modes: the roof on
// top, a wall where each computer card is a window, the ground below. Here the roof is barrel
// tiles and the wall gray-blue stucco with a stone pillar. The ground floor has the porch with its
// white balustrade, plants and jalousie windows, the garage with its rolling door, a wall air
// conditioner and a trash can. Then come the yard, the front fence with its gates, the cement
// strip and the road, where three cars take turns.
//
// Two things are shown apart:
//  - Whether this computer shares: the garage door rolls up and both gates swing open inward.
//    Otherwise all of them are closed.
//  - Sarigüeya's mood, in cream: asleep, sprawled on the balustrade; sitting up grooming while
//    sharing (or, in the Android app, while a computer is ready to connect); wagging her tail fast
//    while connected to or from another computer, even when this one isn't sharing.
// A tap gives a heart.
//
// pixel-home.js draws this house for the home screen, and walks her between it and the night
// house. Needs pixel-scene.js (the cat's sprites, her behavior and her day colors).
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./pixel-scene.js') : root.PixelScene,
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelDay = api;
})(typeof self !== 'undefined' ? self : this, ({ CREAM, Cat, catPixels, mulberry32 }) => {
  // --- Sizes and colors ---

  // The roof's height and the ground floor's (the porch, the garage and the air conditioner), in
  // art pixels.
  const ROOF = 22,
    BAND = 38;
  // The day colors, by name.
  const DAY = {
    // The sky, the clouds, the hills and the trees.
    skyTop: '#7db4e2',
    skyMid: '#a3cdee',
    skyLow: '#d3e9f7',
    cloud: '#ffffff',
    cloudShade: '#e2ebf3',
    cloudDeep: '#c7d6e4',
    hillFar: '#9ec796',
    hillNear: '#7fb06b',
    treeDark: '#2e5c2a',
    tree: '#3f7b34',
    treeLight: '#62a04a',
    // The roof, the eave and the antenna.
    tile: '#d3865b',
    tileLight: '#eaa57b',
    tileDark: '#a95f3f',
    tileGap: '#7f4630',
    tileStain: '#80614c',
    fascia: '#dde2e7',
    eaveShadow: '#8f9aa6',
    antenna: '#6f7880',
    // The stucco wall, its trim and the stone pillar.
    wall: '#b6c0cb',
    wallLight: '#c3ccd6',
    wallShade: '#a6b1bd',
    trim: '#eef1f4',
    stone: '#9d5e3e',
    stoneLight: '#bd7a51',
    stoneDark: '#6e3e2a',
    // The porch: its door, jalousie windows, lamp, balustrade, pots and plants.
    porch: '#97a2ae',
    porchDark: '#86919e',
    door: '#2b2e33',
    doorGlass: '#525d67',
    frame: '#e8ecef',
    louver: '#2f363c',
    louverLine: '#5d666e',
    lamp: '#4a4f55',
    lampBowl: '#c9b48a',
    rail: '#f6f7f6',
    railShade: '#d3d8dc',
    railDark: '#aeb6bd',
    pot: '#b9683f',
    potLight: '#d2834f',
    potDark: '#8d4a2c',
    potGray: '#8f989f',
    potGrayDark: '#717a81',
    leaf: '#3f7f37',
    leafLight: '#65a84b',
    leafDark: '#2a5b26',
    flower: '#f0c640',
    flowerDark: '#c99a1f',
    // The garage: its rolling door, the inside with its bulb, and the white car parked there.
    garage: '#eef1f2',
    garageLine: '#d1d7db',
    garageShade: '#bcc4ca',
    garageGlass: '#3b454d',
    garageRay: '#e9edf0',
    inside: '#2b2825',
    insideLight: '#3b3631',
    bulb: '#ffd36b',
    bulbGlow: '#5e5038',
    car: '#f2f3f3',
    carShade: '#cdd2d5',
    carGlass: '#30373c',
    carLight: '#c8392b',
    plate: '#e8e5d6',
    tire: '#1f2224',
    // The yard: its paving, the grass, the low wall and the solar light.
    walk: '#dcc1a3',
    walkJoint: '#c6a587',
    walkDark: '#ccb092',
    grass: '#58a53a',
    grassDark: '#3f8a2b',
    grassLight: '#82c860',
    lowWall: '#e5e8ea',
    lowWallShade: '#c8ced2',
    solar: '#2d3236',
    solarTop: '#8fa2ad',
    // The air conditioner and the trash can.
    ac: '#e1e5e8',
    acShade: '#b9c0c6',
    acGrille: '#8c969e',
    bracket: '#7a838b',
    bin: '#4e8a5a',
    binDark: '#3a6b45',
    binLid: '#61a06d',
    // The front fence, the cement strip and the road.
    picket: '#f6f7f6',
    picketShade: '#d5d9d8',
    pillar: '#d4d9db',
    pillarShade: '#b3babe',
    pillarCap: '#8e979d',
    fenceBase: '#dcdfdc',
    fenceBaseShade: '#b9bdba',
    cement: '#c9ccc8',
    cementJoint: '#b3b6b2',
    cementCrack: '#a3a6a2',
    edgeLine: '#eef0ee',
    asphalt: '#5b6066',
    asphaltLight: '#686d73',
    asphaltDark: '#4f5459',
    lane: '#ecc94b',
    curb: '#cfd3d6',
    curbShade: '#a9afb4',
    // The cars on the road: the red sedan, the Cybertruck and the blue modern car.
    red: '#c0453a',
    redShade: '#93342c',
    redFade: '#d97a6e',
    steel: '#c9ced2',
    steelShade: '#9fa6ac',
    steelDark: '#7c848b',
    blue: '#2f6fd6',
    blueShade: '#1f4f9e',
    blueLight: '#5d93e8',
    glass: '#26303a',
    glassShine: '#5b7184',
    hub: '#a2a9af',
    carLine: '#25282c',
    headlight: '#fff3c0',
    taillight: '#d63a2f',
    lightBar: '#ffffff',
    // Sarigüeya's own day colors, from pixel-scene.js.
    ...CREAM,
  };
  /** Turns '#rrggbb' into [r, g, b, 255], ready to set into an RGBA buffer. */
  const rgba = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255, 255];
  };
  // The 4×4 ordered-dither (Bayer) matrix, as in pixel-scene.js.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // --- Sprites: Sarigüeya asleep, and the cars ---

  /**
   * Sarigüeya flopped on her side, head on the left: shapes filled, then outlined where they meet
   * the air.
   * @param breath 0 or 1, her two breaths: on 1 her body is a little taller.
   * @returns [x, y, colorName] pixels, 31 wide, with her lowest row at 9.
   */
  function sprawl(breath) {
    const cells = new Map(),
      set = (x, y, mark = '#') => cells.set(y * 40 + x, [x, y, mark]);
    const ellipse = (cx, cy, rx, ry) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
          if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) set(x, y);
    };
    ellipse(14, 6, 9.4, 3.2 + breath * 0.4); // body
    ellipse(5.2, 6, 3.4, 3.2); // head
    // Ears.
    for (const [x, y] of [
      [3, 2],
      [3, 1],
      [4, 2],
      [7, 2],
      [7, 1],
      [6, 2],
    ])
      set(x, y);
    // Front legs, stretched.
    for (let x = 0; x <= 5; x++) {
      set(x, 8);
      set(x, 9);
    }
    // Hind legs.
    for (let x = 20; x <= 26; x++) {
      set(x, 8);
      if (x > 21) set(x, 9);
    }
    // Tail, its tip curling up.
    for (let x = 23; x <= 29; x++) set(x, 6);
    set(30, 5);
    set(30, 4);
    // Pixels are keyed by y * 40 + x. Any pixel next to empty space is outline; her belly, the
    // lower rows between her legs, is in shade.
    const filled = new Set(cells.keys());
    const out = [];
    for (const [key, [x, y]] of cells) {
      const edge = [key - 1, key + 1, key - 40, key + 40].some((neighbor) => !filled.has(neighbor));
      out.push([x, y, edge ? 'catLine' : y >= 8 && x > 7 && x < 21 ? 'catShade' : 'catFill']);
    }
    // The details, wherever they fall on her: her closed eye, her pink nose and the pink in her
    // ears, then the darker marks on her back and tail.
    const detail = [
      [3, 6, 'catLine'],
      [4, 6, 'catLine'],
      [2, 7, 'nose'],
      [3, 1, 'nose'],
      [7, 1, 'nose'],
      [10, 4, 'catDetail'],
      [10, 5, 'catDetail'],
      [13, 3, 'catDetail'],
      [13, 4, 'catDetail'],
      [16, 4, 'catDetail'],
      [16, 5, 'catDetail'],
      [19, 4, 'catDetail'],
      [26, 6, 'catDetail'],
      [28, 6, 'catDetail'],
    ];
    return [
      ...out.filter(([x, y]) => !detail.some(([dx, dy]) => dx === x && dy === y)),
      ...detail.filter(([x, y]) => filled.has(y * 40 + x)),
    ];
  }

  /**
   * Cars on the road, drawn facing right from a body, a cabin, glass and two wheels, then outlined:
   * the faded red sedan from the photos, a Cybertruck and a low modern electric car.
   * @param kind 'red', 'cyber' or 'modern'.
   * @returns { cells, length, wheels }: [x, y, colorName] pixels, the car's length, and the
   *   columns of its wheels' centers. The wheels are centered on row 9 and reach down to row 11.
   */
  function carSprite(kind) {
    const cells = new Map(),
      set = (x, y, color) => cells.set(`${x},${y}`, [x, y, color]);
    let wheels, length;
    if (kind === 'cyber') {
      // The Cybertruck: a body whose top rises straight from the back (row 3) to a peak at
      // column 15 (row 0) and falls straight to the front (row 5). A band of glass follows the
      // slope, split by pillars every 6 columns; a light bar is at the front, the taillights are at
      // the back, and panel lines mark the side.
      length = 34;
      wheels = [7, 26];
      const top = (x) =>
        x >= 15 ? Math.round(((x - 15) * 5) / 18) : Math.round(((15 - x) * 3) / 14);
      for (let x = 0; x < length; x++)
        for (let y = top(x); y <= 9; y++) set(x, y, y >= 8 ? 'steelShade' : 'steel');
      for (let x = 9; x <= 27; x++) {
        const y = top(x) + 1;
        set(x, y, 'glass');
        set(x, y + 1, x % 6 === 0 ? 'steel' : 'glass');
      }
      for (let y = 5; y <= 6; y++) set(33, y, 'lightBar');
      set(0, 3, 'taillight');
      set(0, 4, 'taillight');
      for (let x = 2; x < 32; x += 1) if (x % 9 === 0) set(x, 7, 'steelDark');
    } else {
      // The red sedan and the modern car: a body from row 4 (5 for the lower modern car) to row
      // 8, its top row shorter and its two lowest rows in shade.
      length = 30;
      wheels = [6, 23];
      const body = kind === 'red' ? ['red', 'redShade'] : ['blue', 'blueShade'];
      const low = kind === 'modern' ? 1 : 0;
      for (let y = 4 + low; y <= 8; y++)
        for (let x = y === 4 + low ? 2 : 0; x <= (y === 4 + low ? 27 : 29); x++)
          set(x, y, y >= 7 ? body[1] : body[0]);
      // The cabin on top, a range of columns per row: boxy on the sedan, a long slope on the
      // modern car, which has nothing on row 0.
      const cabin =
        kind === 'red'
          ? [
              [10, 18],
              [9, 19],
              [8, 20],
              [7, 22],
            ]
          : [[], [13, 19], [8, 22], [4, 24], [2, 26]];
      cabin.forEach(([from, to], y) => {
        if (from !== undefined) for (let x = from; x <= to; x++) set(x, y, body[0]);
      });
      // The windows, as [row, from, to]: two side windows on the sedan, with a glint in their top
      // row, and one long window on the modern car.
      const glassRows =
        kind === 'red'
          ? [
              [1, 10, 13],
              [1, 15, 18],
              [2, 9, 13],
              [2, 15, 19],
            ]
          : [
              [2, 10, 20],
              [3, 6, 22],
            ];
      for (const [y, from, to] of glassRows)
        for (let x = from; x <= to; x++)
          set(x, y, x === from + 1 && y === 1 ? 'glassShine' : 'glass');
      // The sedan's paint has faded in patches, as in the photos.
      if (kind === 'red')
        for (const [x, y] of [
          [12, 4],
          [13, 4],
          [20, 5],
          [21, 4],
          [5, 5],
          [25, 5],
          [16, 0],
        ])
          set(x, y, 'redFade');
      // The modern car has a light bar at the front, a wide taillight at the back and a light
      // stripe along its side, with a seam every 8 columns; the sedan has a headlight and a
      // taillight.
      if (kind === 'modern') {
        set(29, 5, 'lightBar');
        set(28, 5, 'lightBar');
        set(0, 5, 'taillight');
        set(1, 5, 'taillight');
        for (let x = 3; x < 27; x++) set(x, 6, x % 8 === 0 ? 'blueShade' : 'blueLight');
      } else {
        set(29, 5, 'headlight');
        set(0, 5, 'taillight');
      }
    }
    // Each wheel: the body is cut away around it, for the wheel arch, and a round tire goes in.
    for (const cx of wheels) {
      for (const [x, y] of [...cells.values()])
        if ((x - cx) ** 2 + (y - 9) ** 2 <= 9 && y >= 7) cells.delete(`${x},${y}`);
      for (let y = 7; y <= 11; y++)
        for (let x = cx - 2; x <= cx + 2; x++)
          if ((x - cx) ** 2 + (y - 9) ** 2 <= 5) set(x, y, 'tire');
    }
    // Then an outline around the car, on the left, right and top, but not below, where the road is.
    const out = [];
    for (const [key, [x, y, color]] of cells) out.push([x, y, color]);
    for (const [x, y] of [...cells.values()])
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
      ])
        if (
          !cells.has(`${x + dx},${y + dy}`) &&
          !out.some(([ox, oy]) => ox === x + dx && oy === y + dy)
        )
          out.push([x + dx, y + dy, 'carLine']);
    return { cells: out, length, wheels };
  }
  const CARS = { red: carSprite('red'), cyber: carSprite('cyber'), modern: carSprite('modern') };

  // --- The day house ---

  /**
   * The day house. Like the night house, it draws nothing until layout() gives it a size; then
   * tick() moves it on and render() draws a frame.
   * @param seed seeds the animation's chances.
   * @param sharing whether this computer shares: the garage and the gates open.
   * @param connected whether it's connected to or from another computer: she wags her tail.
   * @param ready in the Android app, whether a computer is ready to connect: she sits up.
   */
  class DayHouse {
    constructor({ seed = 7, sharing = false, connected = false, ready = false } = {}) {
      this.random = mulberry32(seed);
      this.c = Object.fromEntries(Object.entries(DAY).map(([name, hex]) => [name, rgba(hex)]));
      this.sharing = sharing;
      this.connected = connected;
      this.ready = ready;
      this.mood = this.moodOf();
      this.t = 0;
      // How open the garage door and the gates are, from 0 to 1. They start where they belong.
      this.door = sharing ? 1 : 0;
      this.gate = sharing ? 1 : 0;
      this.g = null; // the layout, from layout()
      this.base = null; // what never moves, as RGBA
      // Connected, she is pixel-scene's Cat in its happy mood, wagging her tail.
      this.happyCat = new Cat(this.random, 'happy');
      this.zs = []; // the z's rising while she sleeps: { x, y, age }
      this.nextZ = 6;
      // Grooming: the step she's at (licking on 1 to 4) and the ticks until the next.
      this.lick = 0;
      this.nextLick = 4;
      this.clouds = [];
      this.hearts = []; // hearts rising after a tap: { x, y, age }
      this.petTicks = 0; // the happy ticks left after a tap
      this.sprawlFrames = [sprawl(0), sprawl(1)];
      this.sitCells = {}; // her sitting pictures, built once each
    }

    // --- Her mood and the state ---

    /**
     * Her mood from the state: 'connected' while connected (or for a while after a tap),
     * 'sharing' while sharing or ready, and 'sleep' otherwise.
     */
    moodOf() {
      return this.connected || this.petTicks
        ? 'connected'
        : this.sharing || this.ready
          ? 'sharing'
          : 'sleep';
    }
    /**
     * A tap on the cat: a heart over her and a few happy seconds (32 ticks) before she returns to
     * her mood.
     */
    pet() {
      this.petTicks = 32;
      this.mood = this.moodOf();
      this.zs = [];
      this.hearts.push({ x: 0, y: 0, age: 0 });
    }
    /**
     * Where she is, in art pixels, for taps and the pointer: lying along the rail while she
     * sleeps, otherwise sitting on it.
     */
    catBox() {
      const g = this.g;
      return this.mood === 'sleep'
        ? { x: g.catX, y: g.railTop - 11, w: 31, h: 11 }
        : { x: g.catX + 10, y: g.railTop - 22, w: 18, h: 22 };
    }
    /** Changes what is shown: sharing, connected and ready, each kept as it was if not given. */
    setState({ sharing = this.sharing, connected = this.connected, ready = this.ready } = {}) {
      this.sharing = sharing;
      this.connected = connected;
      this.ready = ready;
      this.mood = this.moodOf();
      if (this.mood !== 'sleep') this.zs = [];
    }

    // --- The layout and the picture that never moves ---

    /**
     * Sets the size and the layout, and draws what never moves. Sizes are in art pixels: the
     * canvas size, the roof's top row and the ground's top row (streetTop), as for the night house.
     */
    layout({ width, height, roofTop, streetTop }) {
      const w = Math.max(160, width | 0),
        h = Math.max(roofTop + ROOF + BAND + 20, height | 0);
      streetTop = Math.min(Math.max(streetTop, roofTop + ROOF + BAND + 6), h - 12);
      // fx0 and fx1 are the wall's first and last columns.
      const g = (this.g = {
        w,
        h,
        roofTop,
        streetTop,
        facadeTop: roofTop + ROOF,
        fx0: 6,
        fx1: w - 7,
        antenna: Math.floor(w * 0.87),
      });
      // The porch spans 27% to 60% of the width. The garage starts at 66% and is 76 wide, but
      // stops at least 26 columns from the right edge.
      g.porch0 = Math.floor(w * 0.27);
      g.porch1 = Math.floor(w * 0.6);
      g.garage0 = Math.floor(w * 0.66);
      g.garage1 = Math.min(w - 26, g.garage0 + 76);
      // Below streetTop: the yard, then the cement strip (its 3 rows start 21 rows above the
      // bottom, and at least 6 below streetTop), the curb and the road.
      const ground = h - streetTop;
      g.walkTop = streetTop + Math.max(6, ground - 21);
      g.curb = g.walkTop + 3;
      g.roadTop = g.curb + 1;
      this.cars = [];
      this.nextCar = 4;
      this.carTurn = 0;
      // The balustrade's top rail, 14 rows above the ground, runs from 22 columns into the porch;
      // she has its free right end. The air conditioner hangs 14 columns into the wall, and band
      // is the top of the ground floor.
      g.railTop = streetTop - 14;
      g.railX0 = g.porch0 + 22;
      g.catX = g.porch1 - 34;
      g.ac = g.fx0 + 14;
      g.band = streetTop - BAND;
      // About one cloud for every 90 columns (at least 3), spread evenly with a little jitter, in
      // the sky above the roof.
      const sky = mulberry32(3);
      this.clouds = Array.from({ length: Math.max(3, Math.round(w / 90)) }, (_, i) => ({
        x: ((i + 0.3) * w) / Math.max(3, Math.round(w / 90)) + sky() * 30,
        y: 4 + sky() * Math.max(4, roofTop - 26),
        size: 0.8 + sky() * 0.7,
      }));
      this.base = new Uint8ClampedArray(w * h * 4);
      this.paintStatic();
    }

    /** Plots a pixel into an RGBA buffer the size of the layout, if it's inside and has a color. */
    put(buffer, x, y, color) {
      const { w, h } = this.g;
      if (x >= 0 && y >= 0 && x < w && y < h && color) buffer.set(color, (y * w + x) * 4);
    }

    /** Draws what never moves into this.base, from its own fixed seed. */
    paintStatic() {
      const art = mulberry32(11),
        c = this.c,
        buffer = this.base,
        put = (x, y, color) => this.put(buffer, x, y, color);
      const g = this.g,
        { w, h, roofTop, facadeTop, streetTop, fx0, fx1 } = g;
      // Sky in dithered bands, then far and near hills with trees, as at the back of the house.
      // The three blues get lighter toward the horizon and mix at their edges.
      for (let y = 0; y < facadeTop; y++)
        for (let x = 0; x < w; x++) {
          const depth = y / Math.max(1, roofTop + 6),
            dither = BAYER[(y % 4) * 4 + (x % 4)] / 16;
          put(
            x,
            y,
            depth + dither * 0.25 < 0.45
              ? c.skyTop
              : depth + dither * 0.25 < 0.85
                ? c.skyMid
                : c.skyLow,
          );
        }
      // The far hill runs the whole width; the near hill and the trees stand at the right.
      for (let x = 0; x < w; x++) {
        const far = roofTop - 4 - Math.round(4 + 3 * Math.sin(x / 23) + 2 * Math.sin(x / 9 + 1));
        for (let y = far; y < facadeTop; y++) put(x, y, c.hillFar);
        if (x > w * 0.55) {
          const near = roofTop - 1 - Math.round(3 + 2 * Math.sin(x / 13 + 2));
          for (let y = near; y < facadeTop; y++) put(x, y, c.hillNear);
        }
      }
      // Each tree is a round crown, 3 to 6 in radius with a ragged edge, lit at its upper left,
      // with darker leaves here and there.
      for (let i = 0; i < Math.round(w / 22); i++) {
        const cx = Math.floor(w * 0.62 + art() * w * 0.4),
          cy = roofTop - 4 - ((art() * 8) | 0),
          radius = 3 + ((art() * 4) | 0);
        for (let y = -radius; y <= radius; y++)
          for (let x = -radius; x <= radius; x++)
            if (x * x + y * y <= radius * radius + art() * 3)
              put(
                cx + x,
                cy + y,
                y < -radius / 3 && x < 0 ? c.treeLight : art() < 0.25 ? c.treeDark : c.tree,
              );
      }
      // Barrel tiles: courses of five rows, each tile a rounded bump, with the stains of the rain.
      // Across, the pattern repeats every 9 columns: a gap, a cap 5 columns wide, a gap and a pan 2
      // columns wide, and the caps line up from the ridge to the eave. The ends slope as on the
      // night roof; then come the white eave board and its shadow.
      for (let i = 0; i < ROOF; i++) {
        const y = roofTop + i;
        if (i >= ROOF - 2) {
          for (let x = 0; x < w; x++) put(x, y, i === ROOF - 2 ? c.fascia : c.eaveShadow);
          continue;
        }
        const left = Math.max(0, 10 - Math.floor((i * 10) / (ROOF - 3))),
          right = w - 1 - left;
        for (let x = left; x <= right; x++) {
          let color = c.tileDark;
          if (i > 0) {
            // Caps (rounded up, lit on top) alternate with pans (the channels between them, in
            // shade). Each course of caps ends in a rounded lip that throws a small shadow on the
            // course below. Rain stains 30% of the pans and 6% of the caps' lower rows.
            const tileY = (i - 1) % 5,
              tileX = x % 9,
              cap = tileX >= 1 && tileX <= 5;
            if (cap) color = [c.tileDark, c.tile, c.tileLight, c.tileLight, c.tile][tileX - 1];
            else color = tileX === 0 || tileX === 6 ? c.tileGap : c.tileDark;
            if (cap && tileY === 4) color = tileX === 1 || tileX === 5 ? c.tileGap : c.tileDark;
            if (cap && tileY === 0 && tileX > 1 && tileX < 5) color = c.tileLight;
            if (!cap && (tileX === 7 || tileX === 8) && art() < 0.3) color = c.tileStain;
            if (cap && tileY >= 2 && art() < 0.06) color = c.tileStain;
          }
          put(x, y, x === left || x === right ? c.tileGap : color);
        }
      }
      // The TV antenna: a mast with two crossbars.
      const antennaX = g.antenna;
      for (let y = roofTop - 14; y < roofTop; y++) put(antennaX, y, c.antenna);
      for (let d = -4; d <= 4; d++) put(antennaX + d, roofTop - 12, c.antenna);
      for (let d = -2; d <= 2; d++) put(antennaX + d, roofTop - 8, c.antenna);
      // Stucco wall with a stone pillar at its left end and a white trim under the eave. The
      // stucco is flecked lighter and darker, and its last two columns at the right are in shade.
      for (let y = facadeTop; y < streetTop; y++)
        for (let x = fx0; x <= fx1; x++) {
          const roll = art();
          let color = roll < 0.03 ? c.wallShade : roll > 0.97 ? c.wallLight : c.wall;
          // The pillar is 13 columns of stones about 4 wide and 3 tall, set unevenly, each in one
          // of four tones, with dark flecks. Its rightmost column is a line of shade.
          if (x - fx0 < 13) {
            // A fixed pseudo-random number from 0 to 1 for a pair of whole numbers.
            const hash = (a, b) => {
              const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
              return value - Math.floor(value);
            };
            const stoneX = Math.floor((x + hash(Math.floor(y / 3), 1) * 3) / 4),
              stoneY = Math.floor((y + hash(stoneX, 2) * 2) / 3),
              tone = hash(stoneX, stoneY);
            color =
              tone < 0.22
                ? c.stoneDark
                : tone < 0.55
                  ? c.stone
                  : tone < 0.85
                    ? c.stoneLight
                    : c.potDark;
            if (hash(x, y) < 0.08) color = c.stoneDark;
            if (x - fx0 === 12) color = c.wallShade;
          }
          if (fx1 - x < 2) color = c.wallShade;
          put(x, y, y === facadeTop ? c.trim : color);
        }
      // The porch: a recess with the door, the jalousie window and the lamp; the balustrade and
      // pots in front. The recess fills the ground floor between the porch's white side frames, in
      // shadow just under its ceiling.
      const p0 = g.porch0,
        p1 = g.porch1,
        band = g.band;
      for (let y = band; y < streetTop; y++)
        for (let x = p0; x <= p1; x++)
          put(x, y, y === band ? c.frame : y < band + 3 ? c.porchDark : c.porch);
      for (let x = p0 - 1; x <= p1 + 1; x++) put(x, band - 1, c.trim);
      for (let y = band; y < streetTop; y++) {
        put(p0, y, c.frame);
        put(p1, y, c.frame);
      }
      // The front door, 13 wide and 27 tall: panes of glass in a white frame.
      const doorX = p0 + 5,
        doorY = streetTop - 27;
      for (let y = doorY; y < streetTop; y++)
        for (let x = doorX; x < doorX + 13; x++) {
          const inX = x - doorX,
            inY = y - doorY,
            pane = inX > 1 && inX < 11 && inY > 1 && inY < 25 && inX % 3 !== 1 && inY % 4 !== 1;
          put(x, y, inX === 0 || inX === 12 || inY === 0 ? c.frame : pane ? c.doorGlass : c.door);
        }
      /** A jalousie window, ww wide and 15 tall from wx, wy: glass slats in a white frame. */
      const jalousie = (wx, wy, ww) => {
        for (let y = wy; y < wy + 15; y++)
          for (let x = wx; x < wx + ww; x++)
            put(
              x,
              y,
              x === wx || x === wx + ww - 1 || y === wy || y === wy + 14
                ? c.frame
                : (y - wy) % 2 === 0
                  ? c.louverLine
                  : c.louver,
            );
      };
      // Jalousies along the porch, one every 32 columns while they fit, each up to 26 wide.
      for (let wx = p0 + 23; wx + 22 <= p1 - 5; wx += 32)
        jalousie(wx, streetTop - 31, Math.min(26, p1 - 5 - wx));
      // Two more on the wall at the left, under the air conditioner.
      for (let wx = g.ac - 1, i = 0; i < 2 && wx + 24 <= p0 - 5; wx += 32, i++)
        jalousie(wx, streetTop - 30, 24);
      // The lamp hangs from the middle of the porch's ceiling: a stem and a bowl. Near the right
      // end a short chain hangs too.
      const lampX = Math.floor((p0 + p1) / 2);
      for (let y = band + 1; y < band + 4; y++) put(lampX, y, c.lamp);
      for (let x = lampX - 2; x <= lampX + 2; x++) put(x, band + 4, c.lampBowl);
      for (let x = lampX - 1; x <= lampX + 1; x++) put(x, band + 5, c.lampBowl);
      for (let y = band + 1; y < band + 7; y++) put(p1 - 4, y, y % 2 ? c.lamp : c.railDark);
      // Balustrade: top rail, turned balusters every four pixels, bottom rail. A baluster's
      // profile gives its width row by row, and its right edge is in shade.
      const railTop = g.railTop;
      for (let x = g.railX0; x < p1; x++) {
        put(x, railTop, c.rail);
        put(x, railTop + 1, c.railShade);
        put(x, streetTop - 2, c.rail);
        put(x, streetTop - 1, c.railShade);
      }
      for (let x = g.railX0 + 2; x < p1 - 1; x += 4) {
        const profile = [1, 1, 2, 3, 3, 3, 2, 1, 1, 2];
        profile.forEach((width, row) => {
          for (let d = 0; d < width; d++)
            put(
              x + d - (width > 1 ? 1 : 0),
              railTop + 2 + row,
              d === width - 1 && width > 1 ? c.railShade : c.rail,
            );
        });
      }
      // Where the walkway meets the porch, a post: two uprights joined every four rows.
      for (let y = streetTop - 17; y < streetTop; y++) {
        put(p0 + 18, y, c.rail);
        put(p0 + 20, y, c.rail);
        if (y % 4 === 0) put(p0 + 19, y, c.rail);
      }
      // Four pots at the balustrade's foot, as [left, kind, width]. Each is 7 rows tall and
      // narrows by a pixel on each side every 3 rows, with a darker right side (and a lighter rim
      // on the terracotta ones), and has 26 pairs of leaf pixels scattered above it.
      const pots = [
        [g.railX0 + 2, 'pot', 9],
        [g.railX0 + 14, 'pot', 8],
        [g.railX0 + 25, 'potGray', 7],
        [g.railX0 + 35, 'pot', 10],
      ];
      for (const [x0, kind, wide] of pots) {
        for (let y = streetTop - 7; y < streetTop; y++)
          for (let x = x0; x < x0 + wide; x++) {
            const inset = Math.floor((y - (streetTop - 7)) / 3);
            if (x < x0 + inset || x >= x0 + wide - inset) continue;
            put(
              x,
              y,
              y === streetTop - 7
                ? c[kind === 'pot' ? 'potLight' : 'potGray']
                : x === x0 + wide - inset - 1
                  ? c[kind === 'pot' ? 'potDark' : 'potGrayDark']
                  : c[kind],
            );
          }
        for (let i = 0; i < 26; i++) {
          const leafX = x0 + wide / 2 + (art() - 0.5) * (wide + 6),
            leafY = streetTop - 8 - art() * 13;
          put(
            Math.round(leafX),
            Math.round(leafY),
            art() < 0.3 ? c.leafLight : art() < 0.5 ? c.leafDark : c.leaf,
          );
          put(Math.round(leafX) + 1, Math.round(leafY), c.leaf);
        }
      }
      // Elephant ear leaves and a yellow flowering shrub between the porch and the garage: three
      // leaves shaped like diamonds, each with a dark midrib and lit above, and their stem; then
      // the shrub's flowers and leaves, by the garage.
      const plantX = p1 + 3;
      for (const [cx, cy, radius] of [
        [plantX + 4, streetTop - 16, 5],
        [plantX + 11, streetTop - 21, 6],
        [plantX + 7, streetTop - 9, 4],
      ])
        for (let y = -radius; y <= radius; y++)
          for (let x = -radius; x <= radius; x++)
            if (Math.abs(x) + Math.abs(y) * 1.3 <= radius)
              put(cx + x, cy + y, x === 0 ? c.leafDark : y < 0 ? c.leafLight : c.leaf);
      for (let y = streetTop - 12; y < streetTop; y++) put(plantX + 7, y, c.leafDark);
      for (let i = 0; i < 40; i++) {
        const x = g.garage0 - 12 + art() * 12,
          y = streetTop - 6 - art() * 22;
        put(
          Math.round(x),
          Math.round(y),
          art() < 0.35 ? c.flower : art() < 0.5 ? c.flowerDark : c.leafLight,
        );
      }
      // The garage opening; its door is drawn every frame, since it rolls up. Here only the white
      // trim around it.
      for (let y = streetTop - 33; y < streetTop; y++) {
        put(g.garage0 - 2, y, c.trim);
        put(g.garage1 + 1, y, c.trim);
      }
      for (let x = g.garage0 - 2; x <= g.garage1 + 1; x++) put(x, streetTop - 33, c.trim);
      // Air conditioner on brackets, and the trash can under it. The unit is 15 by 9, with a grille
      // on its right part and shade along its top, right and bottom edges, over two slanted
      // brackets.
      const ac = g.ac,
        acTop = g.band - 6;
      for (let y = acTop; y < acTop + 9; y++)
        for (let x = ac; x < ac + 15; x++)
          put(
            x,
            y,
            y === acTop
              ? c.acShade
              : x > ac + 9 && (y - acTop) % 2 === 1
                ? c.acGrille
                : x === ac + 14 || y === acTop + 8
                  ? c.acShade
                  : c.ac,
          );
      for (let d = 0; d < 4; d++) {
        put(ac + 2 + d, acTop + 9 + d, c.bracket);
        put(ac + 12 - d, acTop + 9 + d, c.bracket);
      }
      // The can, 11 wide and 13 tall on the ground: its lid, then a body that narrows every 6
      // rows, ribbed every 4 columns, its right edge darker.
      for (let y = streetTop - 13; y < streetTop; y++)
        for (let x = ac + 2; x < ac + 13; x++) {
          const lid = y < streetTop - 11,
            inset = lid ? 0 : Math.floor((y - streetTop + 11) / 6);
          if (x < ac + 2 + inset || x >= ac + 13 - inset) continue;
          put(
            x,
            y,
            lid ? c.binLid : x === ac + 12 - inset || (x - ac) % 4 === 0 ? c.binDark : c.bin,
          );
        }
      // Ground: grass, the walkway from the gate, the driveway, a low wall at the right and a solar
      // light. First, from the bottom of the yard down: the cement strip with joints every 24
      // columns, cracks and flecks; the curb; and the road, with the curb's shadow, a white edge
      // line, a dashed yellow lane and flecked asphalt.
      for (let y = g.walkTop; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (y < g.curb) {
            const roll = art();
            put(
              x,
              y,
              x % 24 === 0
                ? c.cementJoint
                : roll < 0.04
                  ? c.cementCrack
                  : roll > 0.97
                    ? c.cementJoint
                    : c.cement,
            );
            continue;
          }
          if (y === g.curb) {
            put(x, y, x % 12 === 0 ? c.curbShade : c.curb);
            continue;
          }
          const roadRow = y - g.roadTop,
            roll = art();
          put(
            x,
            y,
            roadRow === 0
              ? c.curbShade
              : roadRow === 2
                ? c.edgeLine
                : roadRow === 9 && x % 14 < 7
                  ? c.lane
                  : roll < 0.1
                    ? c.asphaltDark
                    : roll > 0.93
                      ? c.asphaltLight
                      : c.asphalt,
          );
        }
      // Then the yard: the walkway, which widens toward the street, and the driveway before the
      // garage, both tiled, and grass everywhere else. The first row, along the house, is darker.
      for (let y = streetTop; y < g.walkTop; y++)
        for (let x = 0; x < w; x++) {
          const row = y - streetTop,
            walkL = p0 + 15 - Math.floor(row / 2),
            walkR = p0 + 25 + Math.floor(row / 3);
          const drive =
            x >= g.garage0 - 3 - Math.floor(row / 3) && x <= g.garage1 + 3 + Math.floor(row / 4);
          let color;
          if ((x >= walkL && x <= walkR) || drive) {
            const joint =
              (x * 3 + y * 5 + ((art() * 2) | 0)) % 9 === 0 ||
              ((y - streetTop) % 6 === 5 && art() < 0.6);
            color = joint ? c.walkJoint : art() < 0.08 ? c.walkDark : c.walk;
          } else {
            const roll = art();
            color = roll < 0.18 ? c.grassDark : roll > 0.9 ? c.grassLight : c.grass;
          }
          put(
            x,
            y,
            row === 0
              ? color === c.walk || color === c.walkJoint || color === c.walkDark
                ? c.walkJoint
                : c.grassDark
              : color,
          );
        }
      // The low wall at the right of the garage.
      for (let y = streetTop - 7; y < streetTop + 3; y++)
        for (let x = g.garage1 + 6; x < w; x++)
          put(x, y, y === streetTop - 7 ? c.lowWall : y > streetTop ? c.lowWallShade : c.lowWall);
      // The front fence, along the top of the cement strip. It leaves openings for the walkway's
      // gate and the driveway's (drawGates draws them every frame, since they swing), with a
      // pillar on each side of each, and more pillars every 46 columns where there's room. Between
      // pillars, a section of pickets every 3 columns stands on a base and two rails, their tops
      // rising in a curve toward the middle.
      const base = g.walkTop - 1,
        gaps = [
          [p0 + 11, p0 + 29],
          [g.garage0 - 6, g.garage1 + 6],
        ];
      g.fenceBase = base;
      g.walkGate = gaps[0];
      g.driveGate = gaps[1];
      const open = (x) => gaps.some(([a, b]) => x >= a && x <= b);
      const pillars = [];
      for (const [a, b] of gaps) pillars.push(a - 5, b + 1);
      for (let x = 2; x < w - 4; x += 46)
        if (!open(x) && !open(x + 4) && pillars.every((px) => Math.abs(px - x) > 14))
          pillars.push(x);
      pillars.sort((a, b) => a - b);
      for (let x = 0; x < w; x++) {
        if (open(x)) continue;
        put(x, base, c.fenceBaseShade);
        put(x, base - 1, c.fenceBase);
        put(x, base - 4, c.picketShade);
        put(x, base - 7, c.picketShade);
        const left = Math.max(-1, ...pillars.filter((px) => px + 4 < x)),
          right = Math.min(w, ...pillars.filter((px) => px > x));
        const span = Math.max(1, right - (left + 4)),
          along = (x - left - 4) / span,
          rise = Math.round(3 * Math.sin(Math.PI * Math.max(0, Math.min(1, along))));
        if (x % 3 === 0) {
          const top = base - 9 - rise;
          for (let y = top; y < base - 1; y++) put(x, y, c.picket);
          put(x, top - 1, c.picketShade);
        }
      }
      // Each pillar is 5 wide and 13 tall, shaded on the right, under a cap.
      for (const px of pillars) {
        if (px < -4 || px >= w) continue;
        for (let y = base - 12; y <= base; y++)
          for (let x = px; x < px + 5; x++) put(x, y, x === px + 4 ? c.pillarShade : c.pillar);
        for (let x = px - 1; x < px + 6; x++) {
          put(x, base - 13, c.pillarCap);
          put(x, base - 12, c.pillarShade);
        }
      }
      // A solar light in the yard, between the porch and the garage.
      const solarX = Math.floor((p1 + g.garage0) / 2) + 6;
      for (let y = streetTop + 2; y < streetTop + 9; y++) put(solarX, y, c.solar);
      for (let x = solarX - 1; x <= solarX + 1; x++) {
        put(x, streetTop + 1, c.solarTop);
        put(x, streetTop + 2, c.solar);
      }
    }

    // --- Animation ---

    /** Moves the house on one tick. */
    tick() {
      if (!this.g) return;
      this.t++;
      // The clouds drift right a pixel every 10 ticks, and come back around from the left.
      if (this.t % 10 === 0)
        for (const cloud of this.clouds) {
          cloud.x += 1;
          if (cloud.x > this.g.w + 30) cloud.x = -30;
        }
      // The garage door and the gates move toward open while sharing, and toward closed
      // otherwise: the door in 16 ticks, the gates in 12.
      const want = this.sharing ? 1 : 0;
      if (this.door !== want)
        this.door = Math.max(0, Math.min(1, this.door + (want ? 1 : -1) / 16));
      if (this.gate !== want)
        this.gate = Math.max(0, Math.min(1, this.gate + (want ? 1 : -1) / 12));
      // Asleep, a z every 16 to 26 ticks.
      if (this.mood === 'sleep') {
        if (--this.nextZ <= 0) {
          this.zs.push({ x: 6, y: -2, age: 0 });
          this.nextZ = 16 + ((this.random() * 10) | 0);
        }
      }
      if (this.petTicks && --this.petTicks === 0) this.mood = this.moodOf();
      // Hearts rise a pixel every 2 ticks and last 24; z's rise every 2, drift right every 5 and
      // last 26.
      for (const heart of this.hearts) {
        heart.age++;
        if (heart.age % 2 === 0) heart.y--;
      }
      this.hearts = this.hearts.filter((heart) => heart.age < 24);
      for (const z of this.zs) {
        z.age++;
        if (z.age % 2 === 0) z.y--;
        if (z.age % 5 === 0) z.x++;
      }
      this.zs = this.zs.filter((z) => z.age < 26);
      // Sharing, she grooms: four steps of licking, 2 ticks each (her paw bobs up and down), then
      // a rest of 12 to 25 ticks.
      if (this.mood === 'sharing') {
        if (--this.nextLick <= 0) {
          this.lick = (this.lick + 1) % 6;
          this.nextLick = this.lick === 5 ? 10 + ((this.random() * 14) | 0) : 2;
        }
      }
      if (this.mood === 'connected') this.happyCat.tick();
      // The cars drive on (the red one 2 pixels a tick, the others 3) and leave at the ends. Every
      // 12 to 41 ticks another may come, while fewer than 3 are on the road. The kinds take turns
      // and the lanes alternate: lane 0, the far one, goes right, and lane 1, the near one, left.
      // A car waits while one of its kind is on the road or its lane's entrance is still taken.
      for (const car of this.cars) car.x += car.dir * car.speed;
      this.cars = this.cars.filter((car) => car.x > -40 && car.x < this.g.w + 40);
      if (--this.nextCar <= 0 && this.cars.length < 3) {
        const kind = ['red', 'cyber', 'modern'][this.carTurn % 3],
          lane = this.carTurn % 2,
          dir = lane === 0 ? 1 : -1;
        if (
          !this.cars.some(
            (car) =>
              car.kind === kind ||
              (car.lane === lane && (dir > 0 ? car.x < 50 : car.x > this.g.w - 50)),
          )
        ) {
          this.cars.push({
            kind,
            lane,
            dir,
            speed: kind === 'red' ? 2 : 3,
            x: dir > 0 ? -36 : this.g.w + 2,
          });
          this.carTurn++;
        }
        this.nextCar = 12 + ((this.random() * 30) | 0);
      }
    }

    // --- Drawing each frame ---

    /**
     * Draws the garage door, rolled up as far as this.door says, and what the opening shows: the
     * dark inside and the white car parked there, seen from behind.
     */
    drawGarage(out) {
      const c = this.c,
        g = this.g,
        put = (x, y, col) => this.put(out, x, y, col),
        top = g.streetTop - 32,
        bottom = g.streetTop;
      // Fully open, the door rolls up 30 of its 32 rows. doorBottom is its lower edge.
      const open = Math.round(this.door * 30),
        doorBottom = bottom - open;
      for (let y = top; y < bottom; y++)
        for (let x = g.garage0; x <= g.garage1; x++) {
          if (y < doorBottom) {
            // The door: a panel line every 6 rows below its top band, and its right edge in shade.
            const row = y - top,
              panelLine = row % 6 === 0 && row > 6;
            let col = panelLine ? c.garageLine : x === g.garage1 ? c.garageShade : c.garage;
            // Its top band, rows 1 to 7, holds four sunburst windows, one per quarter of its
            // width: dark glass in a frame, with a hub at the bottom middle and rays at 30, 60,
            // 90, 120 and 150 degrees.
            if (row >= 1 && row <= 7) {
              const span = (g.garage1 - g.garage0) / 4,
                pane = Math.floor((x - g.garage0) / span),
                paneX = x - g.garage0 - pane * span;
              if (paneX > 1.5 && paneX < span - 1.5) {
                col = row === 1 || row === 7 ? c.garageShade : c.garageGlass;
                const rayX = paneX - span / 2,
                  rayY = 6.5 - row,
                  radius = Math.hypot(rayX, rayY),
                  angle = (Math.atan2(rayY, rayX) / Math.PI) * 180;
                if (
                  row > 1 &&
                  row < 7 &&
                  (radius < 1.6 ||
                    (radius < 5.5 && [30, 60, 90, 120, 150].some((a) => Math.abs(angle - a) < 9)))
                )
                  col = c.garageRay;
              }
            }
            put(x, y, col);
          } else {
            // Below the door: the dark inside, with a lighter patch near its ceiling, and the car,
            // 29 wide and 19 tall: its rear window, its taillights, its plate, and the tires and
            // bumper below.
            const cx = Math.floor((g.garage0 + g.garage1) / 2),
              carTop = bottom - 19,
              inX = x - cx;
            let col = c.inside;
            if (y > top + 2 && y < top + 6 && Math.abs(inX) < 6) col = c.insideLight;
            if (Math.abs(inX) <= 14 && y >= carTop) {
              const row = y - carTop;
              col = row < 6 && Math.abs(inX) <= 10 - (row < 2 ? 2 - row : 0) ? c.carGlass : c.car;
              if (row >= 7 && row <= 9 && Math.abs(inX) >= 9 && Math.abs(inX) <= 13)
                col = c.carLight;
              if (row >= 10 && row <= 12 && Math.abs(inX) <= 4) col = c.plate;
              if (row >= 15) col = Math.abs(inX) >= 10 ? c.tire : c.carShade;
            }
            put(x, y, col);
          }
        }
      // Once the door is more than 30% open, the garage's bulb lights near the top, with a glow on
      // either side in the row below. (Fully open, the door's lower edge is drawn over that row.)
      if (this.door > 0.3) {
        const bulbX = Math.floor((g.garage0 + g.garage1) / 2);
        for (let x = bulbX - 2; x <= bulbX + 2; x++) put(x, top + 1, c.bulb);
        for (let x = bulbX - 5; x <= bulbX + 5; x++)
          if (Math.abs(x - bulbX) > 2) put(x, top + 2, c.bulbGlow);
      }
      // The door's lower edge.
      for (let x = g.garage0; x <= g.garage1; x++)
        put(x, doorBottom, open ? c.garageShade : c.garageLine);
    }

    /**
     * The gates of the front fence, like its sections: white pickets with points on two rails. The
     * walkway's is one leaf on the left pillar; the driveway's are two leaves, one on each pillar,
     * rising to the middle. Opening, a leaf swings inward: it narrows toward its hinge and its far
     * end goes back, which reads as a little higher.
     */
    drawGates(out) {
      const c = this.c,
        g = this.g,
        put = (x, y, col) => this.put(out, x, y, col),
        base = g.fenceBase,
        angle = (this.gate * 80 * Math.PI) / 180; // fully open, a leaf has turned 80 degrees
      /**
       * Draws one leaf from its hinge: length columns long, toward dir (1 right, -1 left).
       * rise(along) is how much higher its top is at each point, from its hinge (0) to its far end
       * (1). Turned, it looks shorter (length × cos), its far end lifts by up to 3 rows (3 × sin),
       * and its pickets close up; the last one is its shaded edge.
       */
      const leaf = (hinge, length, dir, rise) => {
        const visible = Math.max(1, Math.round(length * Math.cos(angle))),
          back = 3 * Math.sin(angle),
          step = Math.max(1, Math.round(3 * Math.cos(angle)));
        for (let i = 0; i < visible; i++) {
          const x = hinge + dir * i,
            along = (i + 0.5) / visible,
            lift = Math.round(along * back),
            curve = rise(along);
          put(x, base - 1 - lift, c.fenceBaseShade);
          put(x, base - 4 - lift, c.picketShade);
          put(x, base - 7 - lift, c.picketShade);
          if (i % step === 0 || i === visible - 1) {
            const top = base - 9 - curve - lift;
            for (let y = top; y < base - 1 - lift; y++)
              put(x, y, i === visible - 1 ? c.picketShade : c.picket);
            put(x, top - 1, c.picketShade);
          }
        }
      };
      const [walkFrom, walkTo] = g.walkGate,
        [driveFrom, driveTo] = g.driveGate,
        half = Math.floor((driveTo - driveFrom + 1) / 2);
      leaf(walkFrom, walkTo - walkFrom + 1, 1, () => 0);
      leaf(driveFrom, half, 1, (along) => Math.round(3 * along));
      leaf(driveTo, driveTo - driveFrom + 1 - half, -1, (along) => Math.round(3 * along));
    }

    /**
     * Draws Sarigüeya on the balustrade in her mood: sprawled asleep with z's rising, sitting up
     * grooming while sharing, or wagging her tail while connected; and any hearts from taps.
     */
    drawCat(out) {
      const c = this.c,
        g = this.g,
        put = (x, y, col) => this.put(out, x, y, col);
      // Asleep: her two breaths take turns every 16 ticks, and z's rise from her head, a small z
      // growing into a big Z, in her outline color and then fainter.
      if (this.mood === 'sleep') {
        const frame = this.sprawlFrames[this.t % 32 < 16 ? 0 : 1],
          y0 = g.railTop - 10;
        for (const [x, y, col] of frame) put(g.catX + x, y0 + y, c[col]);
        for (const z of this.zs) {
          const glyph =
            z.age < 10 ? ['###', '.#.', '#..', '###'] : ['####', '..#.', '.#..', '#...', '####'];
          glyph.forEach((row, yy) =>
            [...row].forEach((ch, xx) => {
              if (ch === '#')
                put(g.catX + z.x + xx, y0 + z.y + yy - 4, z.age < 18 ? c.catLine : c.catDim);
            }),
          );
        }
        return;
      }
      // Otherwise she sits on the rail, 10 columns right of where she sleeps. Hearts rise from
      // the top right of her.
      const x0 = g.catX + 10,
        y0 = g.railTop - 22;
      for (const heart of this.hearts) {
        const box = this.catBox(),
          color = heart.age < 14 ? c.heart : c.windowDim;
        ['.#.#.', '#####', '.###.', '..#..'].forEach((row, yy) =>
          [...row].forEach((ch, xx) => {
            if (ch === '#') put(box.x + box.w - 6 + heart.x + xx, box.y - 2 + heart.y + yy, color);
          }),
        );
      }
      if (this.mood === 'connected') {
        this.happyCat.draw(put, x0, y0, c);
        return;
      }
      // Grooming: the front paw goes up to the mouth and down again, eyes closed while she licks.
      // Between licks the picture has no face (see FACES in pixel-scene.js).
      const licking = this.lick > 0 && this.lick < 5,
        key = licking ? 'lick' : 'look';
      if (!this.sitCells[key])
        this.sitCells[key] = catPixels('sit', 'up', null, 'wrap', licking ? 'blink' : null);
      for (const [x, y, col] of this.sitCells[key]) put(x0 + x, y0 + y, c[col]);
      if (licking) {
        // A diagonal foreleg: from the chest, low and to the right, up to the mouth, with the paw
        // at the top. It is 2 pixels wide and moves a pixel up or down from one step to the next;
        // the paw is 3 pixels at its top. Both are outlined in the dim line color and filled
        // cream, with a pink touch at the paw.
        const lift = this.lick % 2 ? 0 : 1,
          leg = [
            [10, 15],
            [10, 14],
            [9, 13],
            [9, 12],
            [8, 11],
            [7, 10],
            [6, 9],
          ].map(([x, y]) => [x, y + lift]);
        const fill = new Set(),
          legCells = [];
        for (const [x, y] of leg)
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
          ]) {
            fill.add(`${x + dx},${y + dy}`);
            legCells.push([x + dx, y + dy]);
          }
        for (const [x, y] of [
          [5, 8 + lift],
          [6, 8 + lift],
          [5, 9 + lift],
        ]) {
          fill.add(`${x},${y}`);
          legCells.push([x, y]);
        }
        for (const [x, y] of legCells)
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ])
            if (!fill.has(`${x + dx},${y + dy}`)) put(x0 + x + dx, y0 + y + dy, c.catDim);
        for (const [x, y] of legCells) put(x0 + x, y0 + y, c.catFill);
        put(x0 + 5, y0 + 8 + lift, c.nose);
      }
    }

    /**
     * Draws the current frame into out, an RGBA buffer the size of the layout.
     * @param cat false leaves her out, for a scene that draws her somewhere else for a while.
     */
    render(out, { cat = true } = {}) {
      const g = this.g,
        c = this.c,
        put = (x, y, col) => this.put(out, x, y, col);
      out.set(this.base);
      // Each cloud is four overlapping ellipses, twice as wide as they are tall, white on top and
      // shaded below, kept above the roof.
      for (const cloud of this.clouds) {
        const radius = Math.round(5 * cloud.size),
          cx = Math.round(cloud.x),
          cy = Math.round(cloud.y);
        for (const [offsetX, offsetY, puffRadius] of [
          [0, 0, radius],
          [radius, -2, radius - 1],
          [-radius, 1, radius - 2],
          [2 * radius - 2, 2, radius - 3],
        ])
          for (let y = -puffRadius; y <= puffRadius; y++)
            for (let x = -puffRadius * 2; x <= puffRadius * 2; x++) {
              if ((x * x) / 4 + y * y > puffRadius * puffRadius) continue;
              const px = cx + offsetX + x,
                py = cy + offsetY + y;
              if (py < 0 || py >= g.roofTop - 2 || px < 0 || px >= g.w) continue;
              put(px, py, y > puffRadius / 2 ? c.cloudDeep : y > 0 ? c.cloudShade : c.cloud);
            }
      }
      this.drawGarage(out);
      this.drawGates(out);
      if (cat) this.drawCat(out);
      // The cars, the far lane first so that the near one passes in front. Their tires rest on row
      // 7 of the road (lane 0) or row 15 (lane 1), and a car going left is drawn mirrored. The hubs
      // shift a pixel every 2 pixels the car moves, so the wheels seem to turn.
      for (const car of [...this.cars].sort((a, b) => a.lane - b.lane)) {
        const sprite = CARS[car.kind],
          bottom = g.roadTop + (car.lane === 0 ? 7 : 15),
          spin = Math.floor(car.x / 2) % 2;
        for (const [x, y, col] of sprite.cells) {
          const px =
            car.dir > 0 ? Math.round(car.x) + x : Math.round(car.x) + sprite.length - 1 - x;
          put(px, bottom - 11 + y, c[col]);
        }
        for (const cx of sprite.wheels)
          put(
            (car.dir > 0 ? Math.round(car.x) + cx : Math.round(car.x) + sprite.length - 1 - cx) +
              (spin ? 1 : 0),
            bottom - 2,
            c.hub,
          );
      }
    }
  }

  return { DAY, ROOF, BAND, DayHouse };
});
