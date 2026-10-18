'use strict';
// The pixel cats: one sits on the welcome screen, and one naps on the monitor during the session, its tail hanging
// past the monitor's edge. Both are the rooftop cat of public/pixel-scene.js on a small canvas, drawn in lines at
// night and as cream Sarigüeya in light mode (the page follows the system's light or dark appearance). A cat moves
// only while its screen is showing and the page is visible, and not at all when the system asks for reduced
// motion. start.js creates the two cats.

// Light mode: the system's light appearance.
const daylight = matchMedia('(prefers-color-scheme: light)');

/**
 * Puts a cat on `canvas`: an image of width by height art pixels, with the cat at x, y in the given mood. `extra`,
 * when given, draws more on every frame (the napper's tail). Returns the cat's controls: setMood(mood), and run(on),
 * which starts or stops its animation.
 */
function pixelCat(canvas, { width, height, x, y, mood, extra }) {
  const art = window.PixelScene;
  if (!art) return { setMood() {}, run() {} };
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const rgba = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, (value >> 8) & 255, value & 255, 255];
  };
  const paint = (palette) =>
    Object.fromEntries(Object.entries(palette).map(([name, hex]) => [name, rgba(hex)]));
  const night = paint(art.PALETTE),
    day = paint({ ...art.PALETTE, ...art.CREAM });
  const cat = new art.Cat(art.mulberry32(Date.now() % 65536), mood);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const put = (px, py, color) => {
    if (px >= 0 && py >= 0 && px < width && py < height)
      image.data.set(color, (py * width + px) * 4);
  };
  let ticks = 0;
  let timer = 0;
  let running = false;
  canvas.width = width;
  canvas.height = height;
  const draw = () => {
    const colors = daylight.matches ? day : night;
    image.data.fill(0);
    cat.draw(put, x, y, colors);
    extra?.(put, colors, ticks, daylight.matches);
    context.putImageData(image, 0, 0);
  };
  const sync = () => {
    clearInterval(timer);
    timer = 0;
    if (running && !document.hidden && !motion.matches)
      timer = setInterval(() => {
        ticks += 1;
        cat.tick();
        draw();
      }, art.TICK);
  };
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  daylight.addEventListener('change', draw);
  draw();
  return {
    setMood(next) {
      cat.setMood(next);
      draw();
    },
    run(on) {
      running = on;
      sync();
    },
  };
}
