'use strict';
// Prototype: the house by day, for light mode. It keeps the night house's layout (public/pixel-house.js): the
// roof on top, a wall where each computer card is a window, the ground below. Here the roof is barrel tiles, the
// wall gray-blue stucco with a stone pillar, and the ground floor has the porch with its white balustrade and
// plants, the garage with its rolling door, a wall air conditioner and a trash can, then grass and stone tiles.
// Two things are shown apart. Whether this computer shares: the garage door rolls up and both gates of the front
// fence swing open inward; otherwise all of them are closed. And Sarigüeya's mood, cream: asleep sprawled on the
// balustrade, sitting up grooming while sharing, wagging her tail fast while connected to or from another
// computer, even when this one isn't sharing. Needs pixel-scene.js.
(function (root) {
  const { Cat, catPixels, mulberry32 } = root.PixelScene;
  const ROOF = 22,
    BAND = 38;
  const DAY = {
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
    tile: '#d3865b',
    tileLight: '#eaa57b',
    tileDark: '#a95f3f',
    tileGap: '#7f4630',
    tileStain: '#80614c',
    fascia: '#dde2e7',
    eaveShadow: '#8f9aa6',
    antenna: '#6f7880',
    wall: '#b6c0cb',
    wallLight: '#c3ccd6',
    wallShade: '#a6b1bd',
    trim: '#eef1f4',
    stone: '#9d5e3e',
    stoneLight: '#bd7a51',
    stoneDark: '#6e3e2a',
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
    ac: '#e1e5e8',
    acShade: '#b9c0c6',
    acGrille: '#8c969e',
    bracket: '#7a838b',
    bin: '#4e8a5a',
    binDark: '#3a6b45',
    binLid: '#61a06d',
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
  const rgba = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 255];
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // Sarigüeya flopped on her side, head on the left: shapes filled, then outlined where they meet the air.
  function sprawl(breath) {
    const cells = new Map(),
      set = (x, y, c = '#') => cells.set(y * 40 + x, [x, y, c]);
    const ellipse = (cx, cy, rx, ry) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
          if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) set(x, y);
    };
    ellipse(14, 6, 9.4, 3.2 + breath * 0.4); // body
    ellipse(5.2, 6, 3.4, 3.2); // head
    for (const [x, y] of [
      [3, 2],
      [3, 1],
      [4, 2],
      [7, 2],
      [7, 1],
      [6, 2],
    ])
      set(x, y); // ears
    for (let x = 0; x <= 5; x++) {
      set(x, 8);
      set(x, 9);
    } // front legs, stretched
    for (let x = 20; x <= 26; x++) {
      set(x, 8);
      if (x > 21) set(x, 9);
    } // hind legs
    for (let x = 23; x <= 29; x++) set(x, 6);
    set(30, 5);
    set(30, 4); // tail
    const filled = new Set(cells.keys());
    const out = [];
    for (const [k, [x, y]] of cells) {
      const edge = [k - 1, k + 1, k - 40, k + 40].some((n) => !filled.has(n));
      out.push([x, y, edge ? 'catLine' : y >= 8 && x > 7 && x < 21 ? 'catShade' : 'catFill']);
    }
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

  // Cars on the road, drawn facing right from a body, a cabin, glass and two wheels, then outlined: the faded red
  // sedan from the photos, a Cybertruck and a low modern electric car.
  function carSprite(kind) {
    const cells = new Map(),
      set = (x, y, c) => cells.set(`${x},${y}`, [x, y, c]);
    let wheels, length;
    if (kind === 'cyber') {
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
      length = 30;
      wheels = [6, 23];
      const body = kind === 'red' ? ['red', 'redShade'] : ['blue', 'blueShade'];
      const low = kind === 'modern' ? 1 : 0;
      for (let y = 4 + low; y <= 8; y++)
        for (let x = y === 4 + low ? 2 : 0; x <= (y === 4 + low ? 27 : 29); x++)
          set(x, y, y >= 7 ? body[1] : body[0]);
      const cabin =
        kind === 'red'
          ? [
              [10, 18],
              [9, 19],
              [8, 20],
              [7, 22],
            ]
          : [[], [13, 19], [8, 22], [4, 24], [2, 26]];
      cabin.forEach(([a, b], y) => {
        if (a !== undefined) for (let x = a; x <= b; x++) set(x, y, body[0]);
      });
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
      for (const [y, a, b] of glassRows)
        for (let x = a; x <= b; x++) set(x, y, x === a + 1 && y === 1 ? 'glassShine' : 'glass');
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
    for (const cx of wheels) {
      for (const [x, y] of [...cells.values()])
        if ((x - cx) ** 2 + (y - 9) ** 2 <= 9 && y >= 7) cells.delete(`${x},${y}`);
      for (let y = 7; y <= 11; y++)
        for (let x = cx - 2; x <= cx + 2; x++)
          if ((x - cx) ** 2 + (y - 9) ** 2 <= 5) set(x, y, 'tire');
    }
    const out = [];
    for (const [key, [x, y, c]] of cells) out.push([x, y, c]);
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

  class DayHouse {
    constructor({ seed = 7, sharing = false, connected = false } = {}) {
      this.random = mulberry32(seed);
      this.c = Object.fromEntries(Object.entries(DAY).map(([k, v]) => [k, rgba(v)]));
      this.sharing = sharing;
      this.connected = connected;
      this.mood = this.moodOf();
      this.t = 0;
      this.door = sharing ? 1 : 0;
      this.gate = sharing ? 1 : 0;
      this.g = null;
      this.base = null;
      this.happyCat = new Cat(this.random, 'happy');
      this.zs = [];
      this.nextZ = 6;
      this.lick = 0;
      this.nextLick = 4;
      this.clouds = [];
      this.sprawlFrames = [sprawl(0), sprawl(1)];
      this.sitCells = {};
    }

    moodOf() {
      return this.connected ? 'connected' : this.sharing ? 'sharing' : 'sleep';
    }
    setState({ sharing = this.sharing, connected = this.connected } = {}) {
      this.sharing = sharing;
      this.connected = connected;
      this.mood = this.moodOf();
      if (this.mood !== 'sleep') this.zs = [];
    }

    layout({ width, height, roofTop, streetTop }) {
      const w = Math.max(160, width | 0),
        h = Math.max(roofTop + ROOF + BAND + 20, height | 0);
      streetTop = Math.min(Math.max(streetTop, roofTop + ROOF + BAND + 6), h - 12);
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
      g.porch0 = Math.floor(w * 0.27);
      g.porch1 = Math.floor(w * 0.6);
      g.garage0 = Math.floor(w * 0.66);
      g.garage1 = Math.min(w - 26, g.garage0 + 76);
      const ground = h - streetTop;
      g.walkTop = streetTop + Math.max(6, ground - 21);
      g.curb = g.walkTop + 3;
      g.roadTop = g.curb + 1;
      this.cars = [];
      this.nextCar = 4;
      this.carTurn = 0;
      g.railTop = streetTop - 14;
      g.railX0 = g.porch0 + 22;
      g.catX = g.porch1 - 34;
      g.ac = g.fx0 + 14;
      g.band = streetTop - BAND;
      const sky = mulberry32(3);
      this.clouds = Array.from({ length: Math.max(3, Math.round(w / 90)) }, (_, i) => ({
        x: ((i + 0.3) * w) / Math.max(3, Math.round(w / 90)) + sky() * 30,
        y: 4 + sky() * Math.max(4, roofTop - 26),
        size: 0.8 + sky() * 0.7,
      }));
      this.base = new Uint8ClampedArray(w * h * 4);
      this.paintStatic();
    }

    put(buffer, x, y, color) {
      const { w, h } = this.g;
      if (x >= 0 && y >= 0 && x < w && y < h && color) buffer.set(color, (y * w + x) * 4);
    }

    paintStatic() {
      const art = mulberry32(11),
        c = this.c,
        b = this.base,
        put = (x, y, color) => this.put(b, x, y, color);
      const g = this.g,
        { w, h, roofTop, facadeTop, streetTop, fx0, fx1 } = g;
      // Sky in dithered bands, then far and near hills with trees, as at the back of the house.
      for (let y = 0; y < facadeTop; y++)
        for (let x = 0; x < w; x++) {
          const t = y / Math.max(1, roofTop + 6),
            d = BAYER[(y % 4) * 4 + (x % 4)] / 16;
          put(x, y, t + d * 0.25 < 0.45 ? c.skyTop : t + d * 0.25 < 0.85 ? c.skyMid : c.skyLow);
        }
      for (let x = 0; x < w; x++) {
        const far = roofTop - 4 - Math.round(4 + 3 * Math.sin(x / 23) + 2 * Math.sin(x / 9 + 1));
        for (let y = far; y < facadeTop; y++) put(x, y, c.hillFar);
        if (x > w * 0.55) {
          const near = roofTop - 1 - Math.round(3 + 2 * Math.sin(x / 13 + 2));
          for (let y = near; y < facadeTop; y++) put(x, y, c.hillNear);
        }
      }
      for (let i = 0; i < Math.round(w / 22); i++) {
        const cx = Math.floor(w * 0.62 + art() * w * 0.4),
          cy = roofTop - 4 - ((art() * 8) | 0),
          r = 3 + ((art() * 4) | 0);
        for (let y = -r; y <= r; y++)
          for (let x = -r; x <= r; x++)
            if (x * x + y * y <= r * r + art() * 3)
              put(
                cx + x,
                cy + y,
                y < -r / 3 && x < 0 ? c.treeLight : art() < 0.25 ? c.treeDark : c.tree,
              );
      }
      // Barrel tiles: courses of four rows, each tile a rounded bump, staggered, with the stains of the rain.
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
            // Caps (rounded up, lit on top) alternate with pans (the channels between them, in shade). Each
            // course of caps ends in a rounded lip that throws a small shadow on the course below.
            const k = (i - 1) % 5,
              u = x % 9,
              cap = u >= 1 && u <= 5;
            if (cap) color = [c.tileDark, c.tile, c.tileLight, c.tileLight, c.tile][u - 1];
            else color = u === 0 || u === 6 ? c.tileGap : c.tileDark;
            if (cap && k === 4) color = u === 1 || u === 5 ? c.tileGap : c.tileDark;
            if (cap && k === 0 && u > 1 && u < 5) color = c.tileLight;
            if (!cap && (u === 7 || u === 8) && art() < 0.3) color = c.tileStain;
            if (cap && k >= 2 && art() < 0.06) color = c.tileStain;
          }
          put(x, y, x === left || x === right ? c.tileGap : color);
        }
      }
      const ax = g.antenna;
      for (let y = roofTop - 14; y < roofTop; y++) put(ax, y, c.antenna);
      for (let d = -4; d <= 4; d++) put(ax + d, roofTop - 12, c.antenna);
      for (let d = -2; d <= 2; d++) put(ax + d, roofTop - 8, c.antenna);
      // Stucco wall with a stone pillar at each end and a white trim under the eave.
      for (let y = facadeTop; y < streetTop; y++)
        for (let x = fx0; x <= fx1; x++) {
          const n = art();
          let color = n < 0.03 ? c.wallShade : n > 0.97 ? c.wallLight : c.wall;
          if (x - fx0 < 13) {
            const hash = (a, b) => {
              const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
              return s - Math.floor(s);
            };
            const bx = Math.floor((x + hash(Math.floor(y / 3), 1) * 3) / 4),
              by = Math.floor((y + hash(bx, 2) * 2) / 3),
              v = hash(bx, by);
            color =
              v < 0.22 ? c.stoneDark : v < 0.55 ? c.stone : v < 0.85 ? c.stoneLight : c.potDark;
            if (hash(x, y) < 0.08) color = c.stoneDark;
            if (x - fx0 === 12) color = c.wallShade;
          }
          if (fx1 - x < 2) color = c.wallShade;
          put(x, y, y === facadeTop ? c.trim : color);
        }
      // The porch: a recess with the door, the jalousie window and the lamp; the balustrade and pots in front.
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
      const dx = p0 + 5,
        dy = streetTop - 27;
      for (let y = dy; y < streetTop; y++)
        for (let x = dx; x < dx + 13; x++) {
          const inX = x - dx,
            inY = y - dy,
            pane = inX > 1 && inX < 11 && inY > 1 && inY < 25 && inX % 3 !== 1 && inY % 4 !== 1;
          put(x, y, inX === 0 || inX === 12 || inY === 0 ? c.frame : pane ? c.doorGlass : c.door);
        }
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
      for (let wx = p0 + 23; wx + 22 <= p1 - 5; wx += 32)
        jalousie(wx, streetTop - 31, Math.min(26, p1 - 5 - wx));
      // Two more on the wall at the left, under the air conditioner.
      for (let wx = g.ac - 1, i = 0; i < 2 && wx + 24 <= p0 - 5; wx += 32, i++)
        jalousie(wx, streetTop - 30, 24);
      const lx = Math.floor((p0 + p1) / 2);
      for (let y = band + 1; y < band + 4; y++) put(lx, y, c.lamp);
      for (let x = lx - 2; x <= lx + 2; x++) put(x, band + 4, c.lampBowl);
      for (let x = lx - 1; x <= lx + 1; x++) put(x, band + 5, c.lampBowl);
      for (let y = band + 1; y < band + 7; y++) put(p1 - 4, y, y % 2 ? c.lamp : c.railDark);
      // Balustrade: top rail, turned balusters every four pixels, bottom rail.
      const rt = g.railTop;
      for (let x = g.railX0; x < p1; x++) {
        put(x, rt, c.rail);
        put(x, rt + 1, c.railShade);
        put(x, streetTop - 2, c.rail);
        put(x, streetTop - 1, c.railShade);
      }
      for (let x = g.railX0 + 2; x < p1 - 1; x += 4) {
        const profile = [1, 1, 2, 3, 3, 3, 2, 1, 1, 2];
        profile.forEach((width, row) => {
          for (let d = 0; d < width; d++)
            put(
              x + d - (width > 1 ? 1 : 0),
              rt + 2 + row,
              d === width - 1 && width > 1 ? c.railShade : c.rail,
            );
        });
      }
      for (let y = streetTop - 17; y < streetTop; y++) {
        put(p0 + 18, y, c.rail);
        put(p0 + 20, y, c.rail);
        if (y % 4 === 0) put(p0 + 19, y, c.rail);
      }
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
          const lxl = x0 + wide / 2 + (art() - 0.5) * (wide + 6),
            ly = streetTop - 8 - art() * 13;
          put(
            Math.round(lxl),
            Math.round(ly),
            art() < 0.3 ? c.leafLight : art() < 0.5 ? c.leafDark : c.leaf,
          );
          put(Math.round(lxl) + 1, Math.round(ly), c.leaf);
        }
      }
      // Elephant ear leaves and a yellow flowering shrub between the porch and the garage.
      const ex = p1 + 3;
      for (const [cx, cy, r] of [
        [ex + 4, streetTop - 16, 5],
        [ex + 11, streetTop - 21, 6],
        [ex + 7, streetTop - 9, 4],
      ])
        for (let y = -r; y <= r; y++)
          for (let x = -r; x <= r; x++)
            if (Math.abs(x) + Math.abs(y) * 1.3 <= r)
              put(cx + x, cy + y, x === 0 ? c.leafDark : y < 0 ? c.leafLight : c.leaf);
      for (let y = streetTop - 12; y < streetTop; y++) put(ex + 7, y, c.leafDark);
      for (let i = 0; i < 40; i++) {
        const x = g.garage0 - 12 + art() * 12,
          y = streetTop - 6 - art() * 22;
        put(
          Math.round(x),
          Math.round(y),
          art() < 0.35 ? c.flower : art() < 0.5 ? c.flowerDark : c.leafLight,
        );
      }
      // The garage opening; its door is drawn every frame, since it rolls up.
      for (let y = streetTop - 33; y < streetTop; y++) {
        put(g.garage0 - 2, y, c.trim);
        put(g.garage1 + 1, y, c.trim);
      }
      for (let x = g.garage0 - 2; x <= g.garage1 + 1; x++) put(x, streetTop - 33, c.trim);
      // Air conditioner on brackets, and the trash can under it.
      const ac = g.ac,
        acy = g.band - 6;
      for (let y = acy; y < acy + 9; y++)
        for (let x = ac; x < ac + 15; x++)
          put(
            x,
            y,
            y === acy
              ? c.acShade
              : x > ac + 9 && (y - acy) % 2 === 1
                ? c.acGrille
                : x === ac + 14 || y === acy + 8
                  ? c.acShade
                  : c.ac,
          );
      for (let d = 0; d < 4; d++) {
        put(ac + 2 + d, acy + 9 + d, c.bracket);
        put(ac + 12 - d, acy + 9 + d, c.bracket);
      }
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
      // Ground: grass, the walkway from the gate, the driveway, a low wall at the right and a solar light.
      for (let y = g.walkTop; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (y < g.curb) {
            const n = art();
            put(
              x,
              y,
              x % 24 === 0
                ? c.cementJoint
                : n < 0.04
                  ? c.cementCrack
                  : n > 0.97
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
            n = art();
          put(
            x,
            y,
            roadRow === 0
              ? c.curbShade
              : roadRow === 2
                ? c.edgeLine
                : roadRow === 9 && x % 14 < 7
                  ? c.lane
                  : n < 0.1
                    ? c.asphaltDark
                    : n > 0.93
                      ? c.asphaltLight
                      : c.asphalt,
          );
        }
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
            const n = art();
            color = n < 0.18 ? c.grassDark : n > 0.9 ? c.grassLight : c.grass;
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
      for (let y = streetTop - 7; y < streetTop + 3; y++)
        for (let x = g.garage1 + 6; x < w; x++)
          put(x, y, y === streetTop - 7 ? c.lowWall : y > streetTop ? c.lowWallShade : c.lowWall);
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
      for (const px of pillars) {
        if (px < -4 || px >= w) continue;
        for (let y = base - 12; y <= base; y++)
          for (let x = px; x < px + 5; x++) put(x, y, x === px + 4 ? c.pillarShade : c.pillar);
        for (let x = px - 1; x < px + 6; x++) {
          put(x, base - 13, c.pillarCap);
          put(x, base - 12, c.pillarShade);
        }
      }
      const sx = Math.floor((p1 + g.garage0) / 2) + 6;
      for (let y = streetTop + 2; y < streetTop + 9; y++) put(sx, y, c.solar);
      for (let x = sx - 1; x <= sx + 1; x++) {
        put(x, streetTop + 1, c.solarTop);
        put(x, streetTop + 2, c.solar);
      }
    }

    tick() {
      if (!this.g) return;
      this.t++;
      if (this.t % 10 === 0)
        for (const cl of this.clouds) {
          cl.x += 1;
          if (cl.x > this.g.w + 30) cl.x = -30;
        }
      const want = this.sharing ? 1 : 0;
      if (this.door !== want)
        this.door = Math.max(0, Math.min(1, this.door + (want ? 1 : -1) / 16));
      if (this.gate !== want)
        this.gate = Math.max(0, Math.min(1, this.gate + (want ? 1 : -1) / 12));
      if (this.mood === 'sleep') {
        if (--this.nextZ <= 0) {
          this.zs.push({ x: 6, y: -2, age: 0 });
          this.nextZ = 16 + ((this.random() * 10) | 0);
        }
      }
      for (const z of this.zs) {
        z.age++;
        if (z.age % 2 === 0) z.y--;
        if (z.age % 5 === 0) z.x++;
      }
      this.zs = this.zs.filter((z) => z.age < 26);
      if (this.mood === 'sharing') {
        if (--this.nextLick <= 0) {
          this.lick = (this.lick + 1) % 6;
          this.nextLick = this.lick === 5 ? 10 + ((this.random() * 14) | 0) : 2;
        }
      }
      if (this.mood === 'connected') this.happyCat.tick();
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

    drawGarage(out) {
      const c = this.c,
        g = this.g,
        put = (x, y, col) => this.put(out, x, y, col),
        top = g.streetTop - 32,
        bottom = g.streetTop;
      const open = Math.round(this.door * 30),
        doorBottom = bottom - open;
      for (let y = top; y < bottom; y++)
        for (let x = g.garage0; x <= g.garage1; x++) {
          if (y < doorBottom) {
            const row = y - top,
              panelLine = row % 6 === 0 && row > 6;
            let col = panelLine ? c.garageLine : x === g.garage1 ? c.garageShade : c.garage;
            if (row >= 1 && row <= 7) {
              const span = (g.garage1 - g.garage0) / 4,
                k = Math.floor((x - g.garage0) / span),
                u = x - g.garage0 - k * span;
              if (u > 1.5 && u < span - 1.5) {
                col = row === 1 || row === 7 ? c.garageShade : c.garageGlass;
                const dxw = u - span / 2,
                  dyw = 6.5 - row,
                  r = Math.hypot(dxw, dyw),
                  angle = (Math.atan2(dyw, dxw) / Math.PI) * 180;
                if (
                  row > 1 &&
                  row < 7 &&
                  (r < 1.6 ||
                    (r < 5.5 && [30, 60, 90, 120, 150].some((a) => Math.abs(angle - a) < 9)))
                )
                  col = c.garageRay;
              }
            }
            put(x, y, col);
          } else {
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
      if (this.door > 0.3) {
        const bx = Math.floor((g.garage0 + g.garage1) / 2);
        for (let x = bx - 2; x <= bx + 2; x++) put(x, top + 1, c.bulb);
        for (let x = bx - 5; x <= bx + 5; x++)
          if (Math.abs(x - bx) > 2) put(x, top + 2, c.bulbGlow);
      }
      for (let x = g.garage0; x <= g.garage1; x++)
        put(x, doorBottom, open ? c.garageShade : c.garageLine);
    }

    // The gates of the front fence, like its sections: white pickets with points on two rails. The walkway's is one
    // leaf on the left pillar; the driveway's are two leaves, one on each pillar, rising to the middle. Opening, a
    // leaf swings inward: it narrows toward its hinge and its far end goes back, which reads as a little higher.
    drawGates(out) {
      const c = this.c,
        g = this.g,
        put = (x, y, col) => this.put(out, x, y, col),
        base = g.fenceBase,
        angle = (this.gate * 80 * Math.PI) / 180;
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
      const [wa, wb] = g.walkGate,
        [da, db] = g.driveGate,
        half = Math.floor((db - da + 1) / 2);
      leaf(wa, wb - wa + 1, 1, () => 0);
      leaf(da, half, 1, (along) => Math.round(3 * along));
      leaf(db, db - da + 1 - half, -1, (along) => Math.round(3 * along));
    }

    drawCat(out) {
      const c = this.c,
        g = this.g,
        put = (x, y, col) => this.put(out, x, y, col);
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
      const x0 = g.catX + 10,
        y0 = g.railTop - 22;
      if (this.mood === 'connected') {
        this.happyCat.draw(put, x0, y0, c);
        return;
      }
      // Grooming: the front paw goes up to the mouth and down again, eyes closed while she licks.
      const licking = this.lick > 0 && this.lick < 5,
        key = licking ? 'lick' : 'look';
      if (!this.sitCells[key])
        this.sitCells[key] = catPixels('sit', 'up', null, 'wrap', licking ? 'blink' : null);
      for (const [x, y, col] of this.sitCells[key]) put(x0 + x, y0 + y, c[col]);
      if (licking) {
        // A diagonal foreleg: from the chest, low and to the right, up to the mouth, with the paw at the top.
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
          cellsOf = [];
        for (const [x, y] of leg)
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
          ]) {
            fill.add(`${x + dx},${y + dy}`);
            cellsOf.push([x + dx, y + dy]);
          }
        for (const [x, y] of [
          [5, 8 + lift],
          [6, 8 + lift],
          [5, 9 + lift],
        ]) {
          fill.add(`${x},${y}`);
          cellsOf.push([x, y]);
        }
        for (const [x, y] of cellsOf)
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ])
            if (!fill.has(`${x + dx},${y + dy}`)) put(x0 + x + dx, y0 + y + dy, c.catDim);
        for (const [x, y] of cellsOf) put(x0 + x, y0 + y, c.catFill);
        put(x0 + 5, y0 + 8 + lift, c.nose);
      }
    }

    render(out) {
      const g = this.g,
        c = this.c,
        put = (x, y, col) => this.put(out, x, y, col);
      out.set(this.base);
      for (const cl of this.clouds) {
        const r = Math.round(5 * cl.size),
          cx = Math.round(cl.x),
          cy = Math.round(cl.y);
        for (const [ox, oy, rr] of [
          [0, 0, r],
          [r, -2, r - 1],
          [-r, 1, r - 2],
          [2 * r - 2, 2, r - 3],
        ])
          for (let y = -rr; y <= rr; y++)
            for (let x = -rr * 2; x <= rr * 2; x++) {
              if ((x * x) / 4 + y * y > rr * rr) continue;
              const px = cx + ox + x,
                py = cy + oy + y;
              if (py < 0 || py >= g.roofTop - 2 || px < 0 || px >= g.w) continue;
              put(px, py, y > rr / 2 ? c.cloudDeep : y > 0 ? c.cloudShade : c.cloud);
            }
      }
      this.drawGarage(out);
      this.drawGates(out);
      this.drawCat(out);
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

  // Browser helper, like PixelHouse.mount: the page measures the box, the roof's top and the ground's top.
  function mount(canvas, { container, measure, scale = 3, sharing = false, connected = false }) {
    const house = new DayHouse({ sharing, connected }),
      ctx = canvas.getContext('2d');
    let image = null;
    canvas.style.imageRendering = 'pixelated';
    const draw = () => {
      if (image) {
        house.render(image.data);
        ctx.putImageData(image, 0, 0);
      }
    };
    const relayout = () => {
      const box = measure(),
        ratio = devicePixelRatio || 1,
        unit = Math.max(1, Math.round(scale * ratio)) / ratio;
      house.layout({
        width: Math.floor(box.width / unit),
        height: Math.floor(box.height / unit),
        roofTop: Math.round(box.roofTop / unit),
        streetTop: Math.round(box.streetTop / unit),
      });
      canvas.width = house.g.w;
      canvas.height = house.g.h;
      canvas.style.width = `${house.g.w * unit}px`;
      canvas.style.height = `${house.g.h * unit}px`;
      image = ctx.createImageData(house.g.w, house.g.h);
      draw();
    };
    new ResizeObserver(relayout).observe(container);
    relayout();
    setInterval(() => {
      house.tick();
      draw();
    }, 125);
    return {
      house,
      setState(state) {
        house.setState(state);
        draw();
      },
      relayout,
    };
  }

  root.DayHouse = { DAY, DayHouse, mount };
})(typeof self !== 'undefined' ? self : this);
