'use strict';
// The home screen's house by night (pixel-house.js) or by day (pixel-day.js), and the walk between
// them. Both houses are drawn at the same size, so the page's windows stay put. Night to day:
// Sarigüeya gets up on the roof ridge, walks to its end, drops down the stone pillar to the air
// conditioner, then to the trash can and the grass, walks to the porch and jumps onto the
// balustrade, while daylight crosses the house from the top left, a dithered edge of pixels at a
// time; she takes her day colors when the light reaches her. Day to night is the same way back,
// with the night coming from the bottom right. With reduced motion the mode changes at once.
//
// The desktop app's main window and the Android app's home screen mount it (each in its own
// start.js). They also use reach() (on the desktop, in night-and-day.js) to switch each
// card on the wall to day colors as the light gets to it.
// The walk is made of steps (journey), turned into one position per frame (frames); a frame lasts
// FRAME milliseconds, while the houses keep ticking every TICK.
(function (root, factory) {
  const api = factory(
    ...(typeof module === 'object' && module.exports
      ? [require('./pixel-scene.js'), require('./pixel-house.js'), require('./pixel-day.js')]
      : [root.PixelScene, root.PixelHouse, root.PixelDay]),
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelHome = api;
})(typeof self !== 'undefined' ? self : this, ({ catPixels }, { House }, { DayHouse, DAY }) => {
  // --- Colors and timing ---

  /** Turns '#rrggbb' into [r, g, b, 255], ready to set into an RGBA buffer. */
  const rgba = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255, 255];
  };
  // The 4×4 ordered-dither (Bayer) matrix, as in pixel-scene.js.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  // The walk's frame and the houses' tick, in ms.
  const FRAME = 50,
    TICK = 125;
  // Her night colors while she walks (by night she has no pink nose, so it's the dim line color).
  const NIGHT_CAT = {
    catLine: '#aab1b5',
    catDim: '#59636a',
    catDetail: '#323b41',
    catShade: '#161d22',
    catFill: '#0f1418',
    eye: '#8feba7',
    nose: '#59636a',
  };
  /** Turns a set of '#rrggbb' colors into RGBA ones, by name. */
  const toRgba = (colors) =>
    Object.fromEntries(Object.entries(colors).map(([name, hex]) => [name, rgba(hex)]));
  // The walker's colors at night and by day (the same names, taken from the day house's colors).
  const PALETTES = {
    night: toRgba(NIGHT_CAT),
    day: toRgba(Object.fromEntries(Object.keys(NIGHT_CAT).map((name) => [name, DAY[name]]))),
  };
  // The night sky, under the night house's transparent sky, so it can be mixed with the day house.
  const NIGHT_SKY = rgba('#0d1115');
  // The air conditioner and the trash can she climbs down, in night colors: the night house
  // doesn't have them, so they are added to it.
  const NIGHT_THINGS = toRgba({
    ac: '#3a454d',
    acShade: '#2a333a',
    acGrille: '#1b2227',
    bracket: '#2f3a42',
    bin: '#1f3a2a',
    binDark: '#162a1f',
    binLid: '#28483a',
  });

  // --- Sarigüeya walking ---

  /**
   * Sarigüeya from the side, facing right, 18 wide and 11 tall with her feet on the bottom row.
   * @param kind 'walk0' and 'walk1' (the two steps of her walk), 'jump' (stretched out in the air)
   *   or 'crouch' (low, before a jump and after landing).
   * @returns [x, y, colorName] pixels: an ellipse for the body and one for the head, two ears, a
   *   tail and legs, outlined where they meet the air, with her belly in shade, an eye and a nose.
   */
  function side(kind) {
    const cells = new Map(),
      set = (x, y) => cells.set(y * 32 + x, [x, y]);
    const ellipse = (cx, cy, rx, ry) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
          if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) set(x, y);
    };
    // The body's ellipse [cx, cy, rx, ry] and the head's center [cx, cy], for each kind.
    const body = {
      walk0: [8, 6.6, 5.6, 2.3],
      walk1: [8, 6.6, 5.6, 2.3],
      jump: [8, 6, 6.4, 1.8],
      crouch: [8, 7.6, 5.4, 2.1],
    }[kind];
    const head = { walk0: [14, 4.2], walk1: [14, 4.2], jump: [15, 5], crouch: [14, 5.6] }[kind];
    ellipse(...body);
    ellipse(head[0], head[1], 2.4, 2.3);
    // Two ears, each two pixels tall, on top of her head.
    for (const dx of [-1, 1]) {
      set(Math.round(head[0] + dx), Math.round(head[1] - 3));
      set(Math.round(head[0] + dx), Math.round(head[1] - 2));
    }
    // Her tail: up behind her while walking (its tip moving with her steps), and out behind her,
    // its tip turned up, while jumping and crouching.
    const tail = {
      walk0: [
        [2, 5],
        [1, 4],
        [1, 3],
        [1, 2],
        [2, 1],
      ],
      walk1: [
        [2, 5],
        [1, 4],
        [1, 3],
        [2, 2],
        [3, 1],
      ],
      jump: [
        [2, 6],
        [1, 6],
        [0, 6],
        [0, 5],
      ],
      crouch: [
        [2, 8],
        [1, 8],
        [0, 8],
        [0, 7],
      ],
    }[kind];
    for (const [x, y] of tail) set(x, y);
    // Her legs: four, two pixels tall, in one place or the other for the two steps; reaching
    // back and forward when she jumps; tucked under her when she crouches.
    const legs = {
      walk0: [
        [4, 9],
        [4, 10],
        [6, 9],
        [6, 10],
        [10, 9],
        [10, 10],
        [12, 9],
        [12, 10],
      ],
      walk1: [
        [5, 9],
        [5, 10],
        [7, 9],
        [7, 10],
        [9, 9],
        [9, 10],
        [11, 9],
        [11, 10],
      ],
      jump: [
        [3, 8],
        [2, 9],
        [1, 10],
        [13, 8],
        [14, 9],
        [15, 10],
      ],
      crouch: [
        [5, 10],
        [6, 10],
        [10, 10],
        [11, 10],
      ],
    }[kind];
    for (const [x, y] of legs) set(x, y);
    // Pixels are keyed by y * 32 + x. Any pixel next to empty space is outline; below the body's
    // middle, she is in shade.
    const out = [];
    for (const [key, [x, y]] of cells) {
      const edge = [key - 1, key + 1, key - 32, key + 32].some((neighbor) => !cells.has(neighbor));
      out.push([x, y, edge ? 'catLine' : y >= Math.round(body[1]) + 1 ? 'catShade' : 'catFill']);
    }
    // Her eye just ahead of the head's center, and her nose below and ahead of it, unless the nose
    // would fall on the outline.
    const eye = [Math.round(head[0]) + 1, Math.round(head[1])],
      nose = [Math.round(head[0]) + 2, Math.round(head[1]) + 1];
    return out.map(([x, y, color]) => [
      x,
      y,
      x === eye[0] && y === eye[1]
        ? 'eye'
        : x === nose[0] && y === nose[1] && color !== 'catLine'
          ? 'nose'
          : color,
    ]);
  }
  const SIDE = Object.fromEntries(
    ['walk0', 'walk1', 'jump', 'crouch'].map((kind) => [kind, side(kind)]),
  );

  /**
   * Her way from her place on the night roof to the balustrade, as steps of walking, jumping and
   * holding a pose, with where the daylight starts and finishes crossing the house. g is the day
   * house's layout; nightX is her left edge on the night roof (the night house's catX).
   *
   * Points are [x, y]: x is her middle and y the row her feet are on. A step is one of:
   *  - { pose, at, frames, face }: hold a pose ('front', sitting as on the night roof, or 'crouch')
   *    for some frames, facing left (-1) or right (1) from then on if face is given;
   *  - { walk: [from, to], speed }: walk along a row, speed pixels a frame;
   *  - { jump: [from, to], height }: jump in an arc that rises height pixels above the straight
   *    line between the two points.
   * light: 'start' marks the step where the light starts crossing, and 'end' the one where it is
   * done.
   */
  function journey(g, nightX) {
    const ridge = g.roofTop,
      eave = g.facadeTop - 2,
      acTop = g.band - 6,
      lid = g.streetTop - 13,
      lawn = g.streetTop + 3,
      seat = nightX + 9;
    return [
      // She sits on the ridge as the night house draws her, crouches, and walks along it to its
      // left end.
      { pose: 'front', at: [seat, ridge], frames: 4 },
      { pose: 'crouch', at: [seat, ridge], frames: 3, face: -1 },
      {
        walk: [
          [seat, ridge],
          [14, ridge],
        ],
        speed: 5,
      },
      // Down to the eave, by the stone pillar, and to the air conditioner.
      {
        jump: [
          [14, ridge],
          [9, eave],
        ],
        height: 4,
        light: 'start',
      },
      {
        jump: [
          [9, eave],
          [g.ac + 4, acTop],
        ],
        height: 3,
      },
      { pose: 'crouch', at: [g.ac + 4, acTop], frames: 2, face: 1 },
      // Down to the trash can's lid, then to the lawn.
      {
        jump: [
          [g.ac + 4, acTop],
          [g.ac + 8, lid],
        ],
        height: 3,
      },
      {
        jump: [
          [g.ac + 8, lid],
          [g.ac + 21, lawn],
        ],
        height: 5,
      },
      // Across the lawn to the porch, and up onto the balustrade.
      {
        walk: [
          [g.ac + 21, lawn],
          [g.catX + 8, lawn],
        ],
        speed: 3.8,
        light: 'end',
      },
      { pose: 'crouch', at: [g.catX + 8, lawn], frames: 3, face: 1 },
      {
        jump: [
          [g.catX + 8, lawn],
          [g.catX + 14, g.railTop],
        ],
        height: 9,
      },
      { pose: 'crouch', at: [g.catX + 14, g.railTop], frames: 5, face: -1 },
    ];
  }
  /**
   * The same way back: the steps in reverse order, each one run backwards and facing the other
   * way. A walk or a jump swaps its ends, and so its light marks; a pose turns around.
   */
  function back(steps) {
    const swap = (light) => (light === 'start' ? 'end' : light === 'end' ? 'start' : undefined);
    return steps
      .slice()
      .reverse()
      .map((step) =>
        step.walk
          ? { ...step, walk: [step.walk[1], step.walk[0]], light: swap(step.light) }
          : step.jump
            ? { ...step, jump: [step.jump[1], step.jump[0]], light: swap(step.light) }
            : { ...step, face: step.face ? -step.face : undefined },
      );
  }
  /**
   * One position, sprite and facing per frame, and the frames where the light starts and ends.
   * @returns { list, lightStart, lightEnd }: list holds { x, y, sprite, face } per frame;
   *   lightEnd comes at least one frame after lightStart.
   */
  function frames(steps) {
    const list = [];
    let lightStart = 0,
      lightEnd = 0,
      face = -1;
    for (const step of steps) {
      if (step.light === 'start') lightStart = list.length;
      if (step.pose) {
        if (step.face) face = step.face;
        for (let i = 0; i < step.frames; i++)
          list.push({ x: step.at[0], y: step.at[1], sprite: step.pose, face });
      } else if (step.walk) {
        // A walk takes a frame for every `speed` pixels, changing step every 2 frames.
        const [[x0, y0], [x1]] = step.walk,
          count = Math.max(1, Math.round(Math.abs(x1 - x0) / (step.speed || 3)));
        face = Math.sign(x1 - x0) || face;
        for (let i = 1; i <= count; i++)
          list.push({
            x: x0 + ((x1 - x0) * i) / count,
            y: y0,
            sprite: Math.floor(i / 2) % 2 ? 'walk1' : 'walk0',
            face,
          });
      } else {
        // A jump takes a frame for every 5 pixels of distance (at least 6) along a parabola, t
        // going from 0 to 1, and lands in a crouch.
        const [[x0, y0], [x1, y1]] = step.jump,
          count = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
        face = Math.sign(x1 - x0) || face;
        for (let i = 1; i <= count; i++) {
          const t = i / count;
          list.push({
            x: x0 + (x1 - x0) * t,
            y: y0 + (y1 - y0) * t - step.height * 4 * t * (1 - t),
            sprite: i === count ? 'crouch' : 'jump',
            face,
          });
        }
      }
      if (step.light === 'end') lightEnd = list.length;
    }
    return { list, lightStart, lightEnd: Math.max(lightEnd, lightStart + 1) };
  }
  /**
   * How far the light has to have come for a point to be lit: from the top left, in a dithered
   * edge. 0 to 1. Mostly the point's place along the diagonal, and a little from the dither
   * matrix, so the edge between night and day is ragged.
   */
  const reach = (x, y, w, h) =>
    0.86 * ((0.62 * x) / w + (0.38 * y) / h) +
    (0.14 * BAYER[(Math.floor(y) % 4) * 4 + (Math.floor(x) % 4)]) / 16;

  // --- Showing the house on a page ---

  /**
   * Browser helper. measure() returns CSS pixels: the box size, the roof's top and the street's
   * top. onLight(light) hears how lit the house is, 0 at night to 1 by day, while it changes and
   * when it settles. ready, for the Android app, has her sit up while a computer is ready to
   * connect, without opening the garage.
   * @param canvas the canvas to draw on, which sits behind the page's content.
   * @param options container (the element it fills, which listens for taps), measure, scale (CSS
   *   pixels per art pixel, 3 by default), mode ('night' or 'day'), sharing, connected, ready and
   *   onLight.
   * @returns controls: mode (the mode shown, or the one she's walking to), changing (whether
   *   she's walking), relayout(), pet(), setState(state), look(), setMode(mode, { animate }),
   *   pause(), resume() and destroy().
   */
  function mount(
    canvas,
    {
      container,
      measure,
      scale = 3,
      mode = 'night',
      sharing = false,
      connected = false,
      ready = false,
      onLight = () => {},
    },
  ) {
    const night = new House({ mood: 'sleep' }),
      day = new DayHouse({ sharing, connected, ready }),
      ctx = canvas.getContext('2d');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    // The canvas's image and each house's picture, the walk under way ({ to, path }) and its
    // frame, and the time since the houses last ticked.
    let image = null,
      nightBuf = null,
      dayBuf = null,
      run = null,
      frameNo = 0,
      timer = 0,
      paused = false,
      sinceTick = 0;
    canvas.style.imageRendering = 'pixelated';
    // The day house shows the state as it is. At night she is happy while connected, awake while
    // sharing or ready, and asleep otherwise.
    const setState = (state) => {
      ({ sharing, connected, ready } = { sharing, connected, ready, ...state });
      day.setState({ sharing, connected, ready });
      night.setMood(connected ? 'happy' : sharing || ready ? 'awake' : 'sleep');
    };
    setState({});
    // Lays both houses out for the container's size: the day house first, then the night house
    // at the same size, with the same roof and street. Too small a box keeps the last layout.
    const relayout = () => {
      const box = measure(),
        ratio = devicePixelRatio || 1,
        unit = Math.max(1, Math.round(scale * ratio)) / ratio;
      const width = Math.floor(box.width / unit),
        height = Math.floor(box.height / unit);
      if (width < 80 || height < 60) return;
      day.layout({
        width,
        height,
        roofTop: Math.round(box.roofTop / unit),
        streetTop: Math.round(box.streetTop / unit),
      });
      night.layout({
        width: day.g.w,
        height: day.g.h,
        roofTop: day.g.roofTop,
        streetTop: day.g.streetTop,
      });
      canvas.width = day.g.w;
      canvas.height = day.g.h;
      canvas.style.width = `${day.g.w * unit}px`;
      canvas.style.height = `${day.g.h * unit}px`;
      image = ctx.createImageData(day.g.w, day.g.h);
      nightBuf = new Uint8ClampedArray(image.data.length);
      dayBuf = new Uint8ClampedArray(image.data.length);
      draw();
    };
    // The night house, opaque, with the air conditioner and the trash can she climbs, in night
    // colors. They are drawn as in the day house's paintStatic, in the same places.
    const paintNight = (cat) => {
      night.render(nightBuf, { cat });
      for (let i = 3; i < nightBuf.length; i += 4)
        if (nightBuf[i] === 0) nightBuf.set(NIGHT_SKY, i - 3);
      const g = day.g,
        c = NIGHT_THINGS,
        ac = g.ac,
        acTop = g.band - 6,
        put = (x, y, col) => {
          if (x >= 0 && y >= 0 && x < g.w && y < g.h) nightBuf.set(col, (y * g.w + x) * 4);
        };
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
      for (let y = g.streetTop - 13; y < g.streetTop; y++)
        for (let x = ac + 2; x < ac + 13; x++) {
          const lid = y < g.streetTop - 11,
            inset = lid ? 0 : Math.floor((y - g.streetTop + 11) / 6);
          if (x >= ac + 2 + inset && x < ac + 13 - inset)
            put(
              x,
              y,
              lid ? c.binLid : x === ac + 12 - inset || (x - ac) % 4 === 0 ? c.binDark : c.bin,
            );
        }
    };
    // Draws her for one frame of the walk: 'front' is the sitting sprite from pixel-scene.js, as
    // on the night roof; the others are her side sprites, mirrored when she faces left.
    const drawWalker = (out, frame, palette) => {
      const g = day.g,
        put = (x, y, col) => {
          if (x >= 0 && y >= 0 && x < g.w && y < g.h && col) out.set(col, (y * g.w + x) * 4);
        };
      if (frame.sprite === 'front') {
        for (const [x, y, col] of catPixels('sit', 'up', null, 'curl', null))
          put(Math.round(frame.x) - 9 + x, Math.round(frame.y) - 22 + y, palette[col]);
        return;
      }
      for (const [x, y, col] of SIDE[frame.sprite])
        put(
          Math.round(frame.x) - 9 + (frame.face > 0 ? x : 17 - x),
          Math.round(frame.y) - 10 + y,
          palette[col],
        );
    };
    /**
     * Draws a frame: the house in its mode or, during the walk, both houses without her, each
     * pixel from the one the light says, and her on top, in day colors once the light has
     * reached her feet. During the walk it also reports the light.
     */
    function draw() {
      if (!image) return;
      const g = day.g,
        out = image.data;
      if (!run) {
        if (mode === 'night') {
          paintNight(true);
          out.set(nightBuf);
        } else day.render(out);
        ctx.putImageData(image, 0, 0);
        return;
      }
      paintNight(false);
      day.render(dayBuf, { cat: false });
      const frame = run.path.list[Math.min(frameNo, run.path.list.length - 1)];
      // How far the light has come, from 0 when it starts to 1 when it's done.
      const progress = Math.max(
        0,
        Math.min(1, (frameNo - run.path.lightStart) / (run.path.lightEnd - run.path.lightStart)),
      );
      // Day comes in from the top left; night comes back from the bottom right.
      const lit = (x, y) => {
        const threshold = reach(x, y, g.w, g.h);
        return run.to === 'day' ? progress > threshold : !(progress > 1 - threshold);
      };
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) {
          const i = (y * g.w + x) * 4;
          out.set((lit(x, y) ? dayBuf : nightBuf).subarray(i, i + 4), i);
        }
      drawWalker(
        out,
        frame,
        lit(
          Math.max(0, Math.min(g.w - 1, Math.round(frame.x))),
          Math.max(0, Math.min(g.h - 1, Math.round(frame.y) - 1)),
        )
          ? PALETTES.day
          : PALETTES.night,
      );
      ctx.putImageData(image, 0, 0);
      onLight(run.to === 'day' ? progress : 1 - progress);
    }
    // Every FRAME: the houses tick every TICK, the walk moves on a frame, and two frames after its
    // last one the walk is over and the new mode settles.
    const step = () => {
      sinceTick += FRAME;
      if (sinceTick >= TICK) {
        sinceTick = 0;
        night.tick();
        day.tick();
      }
      if (run && ++frameNo >= run.path.list.length + 2) {
        mode = run.to;
        run = null;
        onLight(mode === 'day' ? 1 : 0);
      }
      draw();
    };
    // The animation runs only while it isn't paused, the page is visible and motion isn't reduced.
    // Otherwise a walk under way ends at once, in its new mode.
    const sync = () => {
      clearInterval(timer);
      timer = 0;
      if (!paused && !document.hidden && !motion.matches) timer = setInterval(step, FRAME);
      else if (run) {
        mode = run.to;
        run = null;
        onLight(mode === 'day' ? 1 : 0);
        draw();
      }
    };
    // A tap on the cat gives a heart. The canvas sits behind the page, so the container listens,
    // and taps on the page's own controls are left alone. She can't be tapped while she walks.
    const onCat = (event) => {
      const g = day.g,
        rect = canvas.getBoundingClientRect();
      if (
        !g ||
        run ||
        !rect.width ||
        event.target.closest?.('button, a, input, select, textarea, dialog')
      )
        return false;
      const x = ((event.clientX - rect.left) * g.w) / rect.width,
        y = ((event.clientY - rect.top) * g.h) / rect.height;
      if (mode === 'night') {
        const nightLayout = night.g;
        return (
          x >= nightLayout.catX - 2 &&
          x < nightLayout.catX + 26 &&
          y >= nightLayout.roofTop - 24 &&
          y < nightLayout.roofTop
        );
      }
      const box = day.catBox();
      return x >= box.x - 2 && x < box.x + box.w + 2 && y >= box.y - 2 && y < box.y + box.h + 1;
    };
    const pet = () => {
      if (mode === 'night') night.cat.pet();
      else day.pet();
      draw();
    };
    const onClick = (event) => {
      if (onCat(event)) pet();
    };
    const onMove = (event) => {
      container.style.cursor = onCat(event) ? 'pointer' : '';
    };
    const observer = new ResizeObserver(relayout);
    observer.observe(container);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    container.addEventListener('click', onClick);
    container.addEventListener('pointermove', onMove);
    relayout();
    sync();
    return {
      get mode() {
        return run ? run.to : mode;
      },
      get changing() {
        return !!run;
      },
      relayout,
      pet,
      setState: (state) => {
        setState(state);
        draw();
      },
      // At night she looks over when a computer is tapped.
      look() {
        if (mode === 'night' && !run) {
          night.look();
          draw();
        }
      },
      // Changes between night and day, walking her over unless motion is reduced, the house is
      // paused or animate is false. A change asked for while she walks, or to the mode already
      // shown, is ignored.
      setMode(next, { animate = true } = {}) {
        if (next !== 'day' && next !== 'night') return;
        if (run || next === mode) return;
        if (!animate || paused || document.hidden || motion.matches || !image) {
          mode = next;
          onLight(mode === 'day' ? 1 : 0);
          draw();
          return;
        }
        const steps = journey(day.g, night.g.catX);
        run = { to: next, path: frames(next === 'day' ? steps : back(steps)) };
        frameNo = 0;
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
        observer.disconnect();
        document.removeEventListener('visibilitychange', sync);
        motion.removeEventListener('change', sync);
        container.removeEventListener('click', onClick);
        container.removeEventListener('pointermove', onMove);
      },
    };
  }

  return { journey, back, frames, reach, mount };
});
