'use strict';
// The pixel-art house by night, behind the home screen's network list: a tiled roof with the cat
// on its ridge, a brick wall where each computer card is a window, and the street below with its
// lamps. A crescent moon, a skyline and smoke from the chimney complete it. The page decides the
// size and the art follows it: layout() takes the canvas size and the rows where the roof and the
// street start, measured from the page, so the cards sit on the wall.
//
// pixel-home.js draws this house for the home screen, together with the day house (pixel-day.js),
// which keeps the same layout. This file needs pixel-scene.js for the cat (Cat) and the shared
// night colors (PALETTE).
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./pixel-scene.js') : root.PixelScene,
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelHouse = api;
})(typeof self !== 'undefined' ? self : this, ({ PALETTE, Cat, mulberry32 }) => {
  // The tick's length in ms, and the roof's height in art pixels.
  const TICK = 125,
    ROOF = 22;
  // The house's own night colors, added to PALETTE's.
  const HOUSE = {
    roofRidge: '#3a464e',
    roofLip: '#2b363e',
    roofBody: '#1d262d',
    roofSeam: '#151c22',
    roofShade: '#11181d',
    roofEdge: '#2f3a42',
    fascia: '#2c363d',
    shadow: '#0b1014',
    wall: '#141b21',
    mortar: '#10161b',
    quoin: '#1a2228',
    brick: '#1b2329',
    door: '#1d272e',
    skyline: '#11171d',
    skylineWindow: '#284434',
    walk: '#1b2329',
    walkEdge: '#3a454c',
    walkJoint: '#151c21',
    road: '#0e1317',
    lane: '#2a3238',
    post: '#2f3a42',
    postLight: '#3d4950',
    bulb: '#d4f7df',
    bulbDim: '#5d6b62',
    lampGlow: '#1c2c24',
    pool: '#1e2f26',
    moon: '#c5ced3',
    smoke: '#56616a',
    smokeDim: '#333d45',
  };
  /** Turns '#rrggbb' into [r, g, b, 255], ready to set into an RGBA buffer. */
  const rgba = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255, 255];
  };

  /**
   * The night house. Nothing is drawn until layout() gives it a size. Then tick() moves it on and
   * render() draws a frame.
   * @param seed seeds the animation's chances (the time by default).
   * @param mood the cat's first mood (see Cat in pixel-scene.js).
   * @param palette colors to use instead of the default ones, by name, as '#rrggbb'.
   */
  class House {
    constructor({ seed = Date.now(), mood = 'awake', palette } = {}) {
      this.random = mulberry32(seed);
      this.color = Object.fromEntries(
        Object.entries({ ...PALETTE, ...HOUSE, ...palette }).map(([name, hex]) => [
          name,
          rgba(hex),
        ]),
      );
      this.cat = new Cat(this.random, mood);
      this.t = 0;
      this.smoke = []; // puffs from the chimney: { x, y, age }
      this.lampDim = [0, 0]; // for each street lamp, the ticks left of a flicker
      this.stars = [];
      this.g = null; // the layout, from layout()
      this.base = null; // what never moves, as RGBA, transparent where there is sky
    }

    setMood(mood) {
      this.cat.setMood(mood);
    }
    look() {
      this.cat.look();
    }

    /**
     * Sets the size and the layout, and draws what never moves. Sizes are in art pixels: the canvas
     * size, the roof's top row, and the sidewalk's top row.
     */
    layout({ width, height, roofTop, streetTop }) {
      const w = Math.max(80, width | 0),
        h = Math.max(roofTop + ROOF + 30, height | 0);
      // fx0 and fx1 are the wall's first and last columns. The chimney, the antenna, the cat on the
      // ridge and the front door sit at fixed shares of the width, and the two street lamps near
      // the ends. The street starts at least 24 rows below the roof and 8 above the bottom.
      this.g = {
        w,
        h,
        roofTop,
        streetTop: Math.min(Math.max(streetTop, roofTop + ROOF + 24), h - 8),
        fx0: 6,
        fx1: w - 7,
        chimney: Math.floor(w * 0.44),
        antenna: Math.floor(w * 0.87),
        catX: Math.floor(w * 0.66) - 9,
        lamps: [11, w - 12],
        door: Math.floor(w / 2) - 6,
      };
      this.g.facadeTop = roofTop + ROOF;
      // One star for every 16 columns, in the sky above the roof, always in the same places.
      const stars = mulberry32(23);
      this.stars = Array.from({ length: Math.round(w / 16) }, () => ({
        x: (stars() * w) | 0,
        y: 2 + ((stars() * Math.max(1, roofTop - 18)) | 0),
        boost: 0,
        next: 20 + ((stars() * 90) | 0),
      }));
      this.base = new Uint8ClampedArray(w * h * 4);
      this.paintStatic();
    }

    /** Plots one pixel into an RGBA buffer the size of the layout; outside it, nothing. */
    put(buffer, x, y, color) {
      const { w, h } = this.g;
      if (x >= 0 && y >= 0 && x < w && y < h) buffer.set(color, (y * w + x) * 4);
    }

    /** Draws what never moves into this.base, from its own fixed seed. */
    paintStatic() {
      const art = mulberry32(11),
        c = this.color,
        base = this.base,
        put = (x, y, color) => this.put(base, x, y, color);
      const { w, roofTop, facadeTop, streetTop, fx0, fx1 } = this.g;
      // A crescent moon near the top right: a disc with a smaller one taken out of it.
      for (let y = -4; y <= 4; y++)
        for (let x = -4; x <= 4; x++)
          if (x * x + y * y <= 17 && (x + 2) ** 2 + (y - 1) ** 2 > 12)
            put(w - 34 + x, 9 + y, c.moon);
      // The skyline behind the house, over its right part: buildings 7 to 15 wide whose tops rise
      // 5 to 17 rows above the roof, with a few lit windows above the roof line.
      for (let x = Math.floor(w * 0.4); x < w;) {
        const buildingWidth = 7 + ((art() * 9) | 0),
          top = roofTop - 5 - ((art() * 13) | 0);
        for (let y = top; y < facadeTop; y++)
          for (let xx = x; xx < x + buildingWidth; xx++) put(xx, y, c.skyline);
        for (let y = top + 2; y < roofTop; y += 3)
          for (let xx = x + 2; xx < x + buildingWidth - 1; xx += 3)
            if (art() < 0.3) put(xx, y, c.skylineWindow);
        x += buildingWidth + 1 + ((art() * 3) | 0);
      }
      // Ridge, staggered courses of tiles, sloped ends, then the eave board and its shadow. A
      // course is four rows: a lit lip, two rows of tiles with a seam every 8 columns (shifted by
      // 4 on every other course) and a row of shade. The ends slope in from 10 columns at the
      // ridge to none at the eave.
      for (let i = 0; i < ROOF; i++) {
        const y = roofTop + i;
        if (i >= ROOF - 2) {
          for (let x = 0; x < w; x++) put(x, y, i === ROOF - 2 ? c.fascia : c.shadow);
          continue;
        }
        const left = Math.max(0, 10 - Math.floor((i * 10) / (ROOF - 3))),
          right = w - 1 - left;
        for (let x = left; x <= right; x++) {
          let color = c.roofRidge;
          if (i > 0) {
            const courseRow = (i - 1) % 4,
              course = Math.floor((i - 1) / 4);
            color =
              courseRow === 0
                ? c.roofLip
                : courseRow === 3
                  ? c.roofShade
                  : (x + (course % 2) * 4) % 8 === 0
                    ? c.roofSeam
                    : c.roofBody;
          }
          put(x, y, x === left || x === right ? c.roofEdge : color);
        }
      }
      // The chimney, 10 wide, from 11 rows above the roof to 9 rows into it: courses of bricks 3
      // rows tall, the last row mortar, with joints every 6 columns, shifted by 3 on every other
      // course. Then its cap, 12 wide.
      const chimneyX = this.g.chimney,
        antennaX = this.g.antenna;
      for (let y = roofTop - 11; y <= roofTop + 9; y++)
        for (let x = chimneyX; x < chimneyX + 10; x++) {
          const row = y - roofTop + 11;
          put(
            x,
            y,
            row % 3 === 2 || (x - chimneyX + (Math.floor(row / 3) % 2) * 3) % 6 === 0
              ? c.mortar
              : c.brick,
          );
        }
      for (let x = chimneyX - 1; x < chimneyX + 11; x++) {
        put(x, roofTop - 13, c.roofEdge);
        put(x, roofTop - 12, c.fascia);
      }
      // The TV antenna: a mast with two crossbars. Its light, on top, blinks in render().
      for (let y = roofTop - 14; y < roofTop; y++) put(antennaX, y, c.postLight);
      for (let d = -3; d <= 3; d++) put(antennaX + d, roofTop - 11, c.post);
      for (let d = -2; d <= 2; d++) put(antennaX + d, roofTop - 7, c.post);
      // Brick wall with corner stones: courses of 5 rows, the last one mortar, with joints every 12
      // columns (shifted by 6 on every other course). The corner stones are the 4 columns at each
      // end, on every other course. The top row is the eave's shadow.
      for (let y = facadeTop; y < streetTop; y++)
        for (let x = fx0; x <= fx1; x++) {
          const row = y - facadeTop,
            course = Math.floor(row / 5);
          let color = row % 5 === 4 || (x + (course % 2) * 6) % 12 === 0 ? c.mortar : c.wall;
          if ((x - fx0 < 4 || fx1 - x < 4) && course % 2 === 0) color = c.quoin;
          put(x, y, row === 0 ? c.shadow : color);
        }
      // Front door with a small window, then the sidewalk, curb and road. The door is 12 wide and
      // 20 tall: a frame, a line down the middle, a small window across it and a handle.
      const doorX = this.g.door,
        doorY = streetTop - 20;
      for (let y = doorY; y < streetTop; y++)
        for (let x = doorX; x < doorX + 12; x++)
          put(
            x,
            y,
            x === doorX || x === doorX + 11 || y === doorY
              ? c.fascia
              : x === doorX + 6
                ? c.mortar
                : c.door,
          );
      for (let y = doorY + 3; y < doorY + 6; y++)
        for (let x = doorX + 3; x < doorX + 9; x++)
          put(x, y, x === doorX + 6 ? c.mortar : c.windowDim);
      put(doorX + 9, doorY + 12, c.ledgeShine);
      // The ground: the sidewalk's edge, five rows of sidewalk with a joint every 16 columns, the
      // curb and its shadow, then the road with its dashed lane line. The lane line runs down the
      // middle of the road, however tall the page makes the street.
      const laneRow = 8 + Math.max(6, Math.floor((this.g.h - streetTop - 8) / 2));
      for (let y = streetTop; y < this.g.h; y++) {
        const row = y - streetTop;
        for (let x = 0; x < w; x++) {
          let color =
            row === 0
              ? c.walkEdge
              : row < 6
                ? x % 16 === 0
                  ? c.walkJoint
                  : c.walk
                : row === 6
                  ? c.fascia
                  : row === 7
                    ? c.shadow
                    : c.road;
          if (row === laneRow && x % 16 < 8) color = c.lane;
          put(x, y, color);
        }
      }
      // The doorstep, a little wider than the door.
      for (let x = doorX - 2; x < doorX + 14; x++) {
        put(x, streetTop, c.fascia);
        put(x, streetTop + 1, c.roofEdge);
      }
      // The street lamps: a post two pixels wide, the lamp's head on top and a base on the
      // sidewalk. The bulb under the head is drawn in render(), since it flickers.
      for (const lampX of this.g.lamps) {
        for (let y = streetTop - 22; y < streetTop + 4; y++) {
          put(lampX, y, c.post);
          put(lampX + 1, y, c.postLight);
        }
        for (let x = lampX - 3; x <= lampX + 4; x++) put(x, streetTop - 25, c.postLight);
        for (let x = lampX - 2; x <= lampX + 3; x++) put(x, streetTop - 24, c.post);
        for (let x = lampX - 1; x <= lampX + 2; x++) put(x, streetTop + 4, c.postLight);
      }
    }

    /** Moves the house on one tick. */
    tick() {
      if (!this.g) return;
      const random = this.random;
      this.t++;
      // Each star twinkles for 3 ticks every 40 to 130.
      for (const star of this.stars) {
        if (star.boost) star.boost--;
        else if (--star.next <= 0) {
          star.boost = 3;
          star.next = 40 + ((random() * 90) | 0);
        }
      }
      // A puff of smoke leaves the chimney every 9 ticks. It rises a pixel every 2 ticks, drifts
      // right every 3 and is gone after 22.
      if (this.t % 9 === 0)
        this.smoke.push({
          x: this.g.chimney + 4 + ((random() * 2) | 0),
          y: this.g.roofTop - 14,
          age: 0,
        });
      for (const puff of this.smoke) {
        puff.age++;
        if (puff.age % 2 === 0) puff.y--;
        if (puff.age % 3 === 0) puff.x++;
      }
      this.smoke = this.smoke.filter((puff) => puff.age <= 22);
      // Now and then a lamp flickers: each tick, a lit one has a 0.6% chance to dim for 2 ticks.
      this.lampDim = this.lampDim.map((dimTicks) =>
        dimTicks ? dimTicks - 1 : random() < 0.006 ? 2 : 0,
      );
      this.cat.tick();
    }

    /**
     * Draws the current frame into out, an RGBA buffer the size of the layout.
     * @param cat false leaves her out, for a scene that draws her somewhere else for a while.
     */
    render(out, { cat = true } = {}) {
      const g = this.g,
        c = this.color,
        put = (x, y, color) => this.put(out, x, y, color);
      out.set(this.base);
      // Whether a pixel is open sky.
      const sky = (x, y) => this.base[(y * g.w + x) * 4 + 3] === 0;
      for (const star of this.stars)
        if (sky(star.x, star.y)) put(star.x, star.y, star.boost ? c.star : c.starDim);
      for (const puff of this.smoke) put(puff.x, puff.y, puff.age < 12 ? c.smoke : c.smokeDim);
      // The antenna's light flashes for 2 ticks in every 20.
      put(g.antenna, g.roofTop - 15, this.t % 20 < 2 ? c.windowBright : c.starDim);
      g.lamps.forEach((lampX, i) => {
        const lit = !this.lampDim[i],
          bulbY = g.streetTop - 23;
        if (lit) {
          // A lit lamp casts a dithered glow on the wall around it (only over the wall's dark
          // pixels, not the sky) and a dithered pool of light on the sidewalk below.
          for (let dy = -3; dy <= 4; dy++)
            for (let dx = -6; dx <= 7; dx++) {
              const x = lampX + dx,
                yy = bulbY + dy;
              if (
                (dx + dy) % 2 === 0 &&
                (dx * dx) / 2 + dy * dy < 22 &&
                x >= g.fx0 &&
                x <= g.fx1 &&
                this.base[(yy * g.w + x) * 4] < 40 &&
                !sky(x, yy)
              )
                put(x, yy, c.lampGlow);
            }
          for (let dx = -8; dx <= 9; dx++)
            for (let row = 1; row < 6; row++)
              if ((dx + row) % 2 === 0 && Math.abs(dx) < 9 - row)
                put(lampX + dx, g.streetTop + row, c.pool);
        }
        for (let x = lampX - 1; x <= lampX + 2; x++) put(x, bulbY, lit ? c.bulb : c.bulbDim);
      });
      // The cat, standing on the ridge.
      if (cat) this.cat.draw(put, g.catX, g.roofTop - 22, c);
    }
  }

  /**
   * Browser helper that shows the night house on its own. (The home screen uses pixel-home.js,
   * which draws this house and the day house together.) measure() returns CSS pixels: the box
   * size, the roof's top and the street's top. Each art pixel covers a whole number of device
   * pixels, and styles go through the CSSOM.
   * @param canvas the canvas to draw on, which sits behind the page's content.
   * @param options container (the element it fills, which listens for taps), measure, scale (CSS
   *   pixels per art pixel, 3 by default) and House's options.
   * @returns the house and its controls: relayout(), pet(), setMood(mood), look(), pause(),
   *   resume() and destroy().
   */
  function mount(canvas, { container, measure, scale = 3, ...options }) {
    const house = new House(options),
      ctx = canvas.getContext('2d'),
      motion = matchMedia('(prefers-reduced-motion: reduce)');
    let image = null,
      timer = 0,
      paused = false;
    canvas.style.imageRendering = 'pixelated';
    const draw = () => {
      if (image) {
        house.render(image.data);
        ctx.putImageData(image, 0, 0);
      }
    };
    // Lays the house out again for the container's size; too small a box keeps the last layout.
    const relayout = () => {
      const box = measure(),
        ratio = devicePixelRatio || 1,
        unit = Math.max(1, Math.round(scale * ratio)) / ratio;
      const width = Math.floor(box.width / unit),
        height = Math.floor(box.height / unit);
      if (width < 80 || height < 60) return;
      house.layout({
        width,
        height,
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
    // The animation runs only while it isn't paused, the page is visible and motion isn't reduced.
    const sync = () => {
      clearInterval(timer);
      timer = 0;
      if (!paused && !document.hidden && !motion.matches)
        timer = setInterval(() => {
          house.tick();
          draw();
        }, TICK);
    };
    const observer = new ResizeObserver(relayout);
    observer.observe(container);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    // Tapping the cat gives a heart. The canvas sits behind the page, so the container listens,
    // and taps on the page's own controls are left alone.
    const onCat = (event) => {
      const g = house.g,
        rect = canvas.getBoundingClientRect();
      if (!g || !rect.width || event.target.closest?.('button, a, input, select, textarea, dialog'))
        return false;
      const x = ((event.clientX - rect.left) * g.w) / rect.width,
        y = ((event.clientY - rect.top) * g.h) / rect.height;
      return x >= g.catX - 2 && x < g.catX + 26 && y >= g.roofTop - 24 && y < g.roofTop;
    };
    const onClick = (event) => {
      if (onCat(event)) {
        house.cat.pet();
        draw();
      }
    };
    const onMove = (event) => {
      container.style.cursor = onCat(event) ? 'pointer' : '';
    };
    container.addEventListener('click', onClick);
    container.addEventListener('pointermove', onMove);
    relayout();
    sync();
    return {
      house,
      relayout,
      pet() {
        house.cat.pet();
        draw();
      },
      setMood(mood) {
        house.setMood(mood);
        draw();
      },
      look() {
        house.look();
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

  return { TICK, HOUSE, House, mount };
});
