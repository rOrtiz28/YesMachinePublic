'use strict';
// Prototype: switching between the night house (public/pixel-house.js) and the day house (day-house.js). Both are
// drawn at the same size, so the page's windows stay put. Night to day: Sarigüeya gets up on the roof ridge, walks
// to the end, drops down the stone pillar to the air conditioner, then to the trash can and the grass, walks to the
// porch and jumps onto the balustrade to sleep, while daylight crosses the house from the top left, a dithered edge
// of pixels at a time. She takes her day colors when the light reaches her. Day to night is the same way back,
// with the night coming from the bottom right. Needs pixel-scene.js, pixel-house.js and day-house.js.
(function (root) {
  const { catPixels } = root.PixelScene,
    { House } = root.PixelHouse,
    { DayHouse, DAY } = root.DayHouse;
  const rgba = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 255];
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const FRAME = 50;
  const NIGHT_CAT = {
    catLine: '#aab1b5',
    catDim: '#59636a',
    catDetail: '#323b41',
    catShade: '#161d22',
    catFill: '#0f1418',
    eye: '#8feba7',
    nose: '#59636a',
  };
  const DAY_CAT = Object.fromEntries(Object.keys(NIGHT_CAT).map((k) => [k, DAY[k]]));
  const PALETTES = {
    night: Object.fromEntries(Object.entries(NIGHT_CAT).map(([k, v]) => [k, rgba(v)])),
    day: Object.fromEntries(Object.entries(DAY_CAT).map(([k, v]) => [k, rgba(v)])),
  };
  const NIGHT_SKY = rgba('#0b1014');
  const NIGHT_THINGS = {
    ac: rgba('#3a454d'),
    acShade: rgba('#2a333a'),
    acGrille: rgba('#1b2227'),
    bracket: rgba('#2f3a42'),
    bin: rgba('#1f3a2a'),
    binDark: rgba('#162a1f'),
    binLid: rgba('#28483a'),
  };

  // Sarigüeya from the side, facing right, 18 wide and 11 tall with her feet on the bottom row.
  function side(kind) {
    const cells = new Map(),
      set = (x, y) => cells.set(y * 32 + x, [x, y]);
    const ellipse = (cx, cy, rx, ry) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
          if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) set(x, y);
    };
    const body = {
      walk0: [8, 6.6, 5.6, 2.3],
      walk1: [8, 6.6, 5.6, 2.3],
      jump: [8, 6, 6.4, 1.8],
      crouch: [8, 7.6, 5.4, 2.1],
    }[kind];
    const head = { walk0: [14, 4.2], walk1: [14, 4.2], jump: [15, 5], crouch: [14, 5.6] }[kind];
    ellipse(...body);
    ellipse(head[0], head[1], 2.4, 2.3);
    for (const dx of [-1, 1]) {
      set(Math.round(head[0] + dx), Math.round(head[1] - 3));
      set(Math.round(head[0] + dx), Math.round(head[1] - 2));
    }
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
    const out = [];
    for (const [k, [x, y]] of cells) {
      const edge = [k - 1, k + 1, k - 32, k + 32].some((n) => !cells.has(n));
      out.push([x, y, edge ? 'catLine' : y >= Math.round(body[1]) + 1 ? 'catShade' : 'catFill']);
    }
    const eye = [Math.round(head[0]) + 1, Math.round(head[1])],
      nose = [Math.round(head[0]) + 2, Math.round(head[1]) + 1];
    return out.map(([x, y, c]) => [
      x,
      y,
      x === eye[0] && y === eye[1]
        ? 'eye'
        : x === nose[0] && y === nose[1] && c !== 'catLine'
          ? 'nose'
          : c,
    ]);
  }
  const SIDE = Object.fromEntries(
    ['walk0', 'walk1', 'jump', 'crouch'].map((kind) => [kind, side(kind)]),
  );

  // The way from her place on the night roof to the balustrade, as steps of walking, jumping and holding a pose.
  function journey(g, nightX) {
    const ridge = g.roofTop,
      eave = g.facadeTop - 2,
      acTop = g.band - 6,
      lid = g.streetTop - 13,
      lawn = g.streetTop + 3,
      seat = nightX + 9;
    return [
      { pose: 'front', at: [seat, ridge], frames: 4 },
      { pose: 'crouch', at: [seat, ridge], frames: 3, face: -1 },
      {
        walk: [
          [seat, ridge],
          [14, ridge],
        ],
        speed: 5,
      },
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
  // The same way back: steps in reverse order, each one run backwards and facing the other way.
  function back(steps) {
    return steps
      .slice()
      .reverse()
      .map((step) =>
        step.walk
          ? {
              ...step,
              walk: [step.walk[1], step.walk[0]],
              light: step.light === 'end' ? 'start' : step.light === 'start' ? 'end' : undefined,
            }
          : step.jump
            ? {
                ...step,
                jump: [step.jump[1], step.jump[0]],
                light: step.light === 'start' ? 'end' : step.light === 'end' ? 'start' : undefined,
              }
            : { ...step, face: step.face ? -step.face : undefined },
      );
  }
  // Turns the steps into one position, sprite and facing per frame, and the frames where the light starts and ends.
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
        const [[x0, y0], [x1]] = step.walk,
          n = Math.max(1, Math.round(Math.abs(x1 - x0) / (step.speed || 3)));
        face = Math.sign(x1 - x0) || face;
        for (let i = 1; i <= n; i++)
          list.push({
            x: x0 + ((x1 - x0) * i) / n,
            y: y0,
            sprite: Math.floor(i / 2) % 2 ? 'walk1' : 'walk0',
            face,
          });
      } else {
        const [[x0, y0], [x1, y1]] = step.jump,
          n = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
        face = Math.sign(x1 - x0) || face;
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          list.push({
            x: x0 + (x1 - x0) * t,
            y: y0 + (y1 - y0) * t - step.height * 4 * t * (1 - t),
            sprite: i === n ? 'crouch' : 'jump',
            face,
          });
        }
      }
      if (step.light === 'end') lightEnd = list.length;
    }
    return { list, lightStart, lightEnd: Math.max(lightEnd, lightStart + 1) };
  }

  function mount(canvas, { container, measure, scale = 3, onLight = () => {} }) {
    const night = new House({ mood: 'sleep' }),
      day = new DayHouse({}),
      ctx = canvas.getContext('2d');
    const nightCatDraw = night.cat.draw.bind(night.cat),
      dayCatDraw = day.drawCat.bind(day);
    let mode = 'night',
      run = null,
      image = null,
      nightBuf = null,
      dayBuf = null,
      frameNo = 0,
      lastLight = -1;
    canvas.style.imageRendering = 'pixelated';
    const relayout = () => {
      const box = measure(),
        ratio = devicePixelRatio || 1,
        unit = Math.max(1, Math.round(scale * ratio)) / ratio;
      const size = {
        width: Math.floor(box.width / unit),
        height: Math.floor(box.height / unit),
        roofTop: Math.round(box.roofTop / unit),
        streetTop: Math.round(box.streetTop / unit),
      };
      day.layout(size);
      night.layout({ ...size, width: day.g.w, height: day.g.h, streetTop: day.g.streetTop });
      canvas.width = day.g.w;
      canvas.height = day.g.h;
      canvas.style.width = `${day.g.w * unit}px`;
      canvas.style.height = `${day.g.h * unit}px`;
      image = ctx.createImageData(day.g.w, day.g.h);
      nightBuf = new Uint8ClampedArray(image.data.length);
      dayBuf = new Uint8ClampedArray(image.data.length);
    };
    const threshold = (x, y) => {
      const g = day.g;
      return (
        0.86 * ((0.62 * x) / g.w + (0.38 * y) / g.h) + (0.14 * BAYER[(y % 4) * 4 + (x % 4)]) / 16
      );
    };
    // The night house, with a dark sky behind it and the air conditioner and the trash can, which the day has too.
    const paintNight = () => {
      night.render(nightBuf);
      for (let i = 3; i < nightBuf.length; i += 4)
        if (nightBuf[i] === 0) nightBuf.set(NIGHT_SKY, i - 3);
      const g = day.g,
        put = (x, y, col) => {
          if (x >= 0 && y >= 0 && x < g.w && y < g.h) nightBuf.set(col, (y * g.w + x) * 4);
        },
        c = NIGHT_THINGS,
        ac = g.ac,
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
    const drawCat = (put, f, palette) => {
      if (f.sprite === 'front') {
        for (const [x, y, col] of catPixels('sit', 'up', null, 'curl', null))
          put(Math.round(f.x) - 9 + x, Math.round(f.y) - 22 + y, palette[col]);
        return;
      }
      for (const [x, y, col] of SIDE[f.sprite])
        put(
          Math.round(f.x) - 9 + (f.face > 0 ? x : 17 - x),
          Math.round(f.y) - 10 + y,
          palette[col],
        );
    };
    const draw = () => {
      if (!image) return;
      const g = day.g,
        out = image.data;
      if (!run) {
        if (mode === 'night') {
          night.cat.draw = nightCatDraw;
          paintNight();
          out.set(nightBuf);
        } else {
          day.drawCat = dayCatDraw;
          day.render(out);
        }
        ctx.putImageData(image, 0, 0);
        return;
      }
      night.cat.draw = () => {};
      day.drawCat = () => {};
      paintNight();
      day.render(dayBuf);
      const f = run.path.list[Math.min(frameNo, run.path.list.length - 1)];
      const p = Math.max(
        0,
        Math.min(1, (frameNo - run.path.lightStart) / (run.path.lightEnd - run.path.lightStart)),
      );
      // Day comes in from the top left; night comes back from the bottom right.
      const showsDay = (x, y) => {
        const t = threshold(x, y);
        return run.to === 'day' ? p > t : !(p > 1 - t);
      };
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) {
          const i = (y * g.w + x) * 4;
          out.set((showsDay(x, y) ? dayBuf : nightBuf).subarray(i, i + 4), i);
        }
      const lit = showsDay(
        Math.max(0, Math.min(g.w - 1, Math.round(f.x))),
        Math.max(0, Math.min(g.h - 1, Math.round(f.y) - 1)),
      );
      drawCat(
        (x, y, col) => {
          if (x >= 0 && y >= 0 && x < g.w && y < g.h && col) out.set(col, (y * g.w + x) * 4);
        },
        f,
        lit ? PALETTES.day : PALETTES.night,
      );
      ctx.putImageData(image, 0, 0);
      const light = run.to === 'day' ? p : 1 - p;
      if (Math.abs(light - lastLight) > 0.02 || light === 0 || light === 1) {
        lastLight = light;
        onLight(light);
      }
    };
    new ResizeObserver(() => {
      relayout();
      draw();
    }).observe(container);
    relayout();
    draw();
    let tick = 0;
    setInterval(() => {
      tick++;
      if (tick % 2 === 0) {
        night.tick();
        day.tick();
      }
      if (run) {
        frameNo++;
        if (frameNo >= run.path.list.length + 2) {
          mode = run.to;
          run = null;
          onLight(mode === 'day' ? 1 : 0);
        }
      }
      draw();
    }, FRAME);
    return {
      get mode() {
        return mode;
      },
      toggle() {
        if (run) return;
        const steps = journey(day.g, night.g.catX),
          to = mode === 'night' ? 'day' : 'night';
        run = { to, path: frames(to === 'day' ? steps : back(steps)) };
        frameNo = 0;
        lastLight = -1;
      },
      setState({ sharing, connected }) {
        day.setState({ sharing, connected });
        night.setMood(connected ? 'happy' : sharing ? 'awake' : 'sleep');
      },
    };
  }

  root.DayNight = { mount, journey, frames, back };
})(typeof self !== 'undefined' ? self : this);
