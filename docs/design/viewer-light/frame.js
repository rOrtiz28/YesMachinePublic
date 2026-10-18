'use strict';
// Runs inside each preview frame: takes night or day, the session's state, the open drawer panel and the frame
// color from the address or from the preview page's messages, and draws the pixel cats in the matching colors.
(() => {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const NIGHT = PixelScene.PALETTE;
  // Sarigüeya's colors by day, as in pixel-day.js.
  const DAY = {
    ...NIGHT,
    catFill: '#f2ddb9',
    catShade: '#e0c296',
    catLine: '#7b5b3d',
    catDim: '#a98560',
    catDetail: '#cfa676',
    eye: '#4f9a5c',
    heart: '#e0607e',
    windowDim: '#e9a6b6',
    glow: '#ffffff',
    star: '#b9c6d2',
    starDim: '#d8e1ea',
  };
  const rgba = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 255];
  };
  const colorsOf = (palette) =>
    Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, rgba(v)]));
  const night = colorsOf(NIGHT),
    day = colorsOf(DAY);
  const isDay = () => root.classList.contains('day');

  function pixelCat(canvas, { width, height, x, y, mood, extra }) {
    if (!canvas) return null;
    const context = canvas.getContext('2d'),
      image = context.createImageData(width, height);
    const cat = new PixelScene.Cat(PixelScene.mulberry32(7), mood);
    const put = (px, py, color) => {
      if (px >= 0 && py >= 0 && px < width && py < height)
        image.data.set(color, (py * width + px) * 4);
    };
    let ticks = 0;
    canvas.width = width;
    canvas.height = height;
    const draw = () => {
      const c = isDay() ? day : night;
      image.data.fill(0);
      cat.draw(put, x, y, c);
      extra?.(put, c, ticks, isDay());
      context.putImageData(image, 0, 0);
    };
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      setInterval(() => {
        ticks++;
        cat.tick();
        draw();
      }, PixelScene.TICK);
    draw();
    return { draw };
  }

  // The napper's tail hangs past the monitor's right edge. By night it is one line, as the cat is drawn in lines; by
  // day Sarigüeya is cream, so her tail is cream with a brown outline, one pixel further out.
  const napper = pixelCat(document.getElementById('napper'), {
    width: 48,
    height: 48,
    x: 12,
    y: 0,
    mood: 'nap',
    extra: (put, color, ticks, sunny) => {
      const swing = [0, 1, 1, 0, -1, -1][Math.floor(ticks / 3) % 6];
      if (!sunny) {
        for (let x = 30; x <= 35; x++) put(x, 21, color.catLine);
        for (let y = 22; y < 33; y++) put(35 + (y > 28 ? swing : 0), y, color.catLine);
        put(35 + swing, 33, color.catDim);
        return;
      }
      for (let x = 30; x <= 36; x++) {
        put(x, 20, color.catLine);
        put(x, 21, color.catFill);
      }
      put(37, 20, color.catLine);
      put(37, 21, color.catLine);
      for (let y = 21; y < 33; y++) {
        const s = y > 28 ? swing : 0;
        put(35 + s, y, y === 21 ? color.catFill : color.catLine);
        put(36 + s, y, color.catFill);
        put(37 + s, y, color.catLine);
      }
      put(36 + swing, 33, color.catLine);
      put(35 + swing, 32, color.catDim);
      put(37 + swing, 32, color.catDim);
    },
  });
  const welcome = pixelCat(document.getElementById('welcome-cat'), {
    width: 32,
    height: 32,
    x: 4,
    y: 10,
    mood: 'awake',
  });

  function apply({ theme, state, panel, frames } = {}) {
    if (theme) root.classList.toggle('day', theme === 'day');
    if (frames) root.classList.toggle('dark-frames', frames === 'dark');
    const session = document.getElementById('session');
    if (session && state) {
      session.dataset.state = state;
      const waiting =
        document.getElementById('video-placeholder') || document.getElementById('waiting');
      if (waiting) waiting.hidden = state === 'connected';
      const detail =
        document.getElementById('connection-detail') || document.getElementById('detail');
      if (detail)
        detail.textContent =
          state === 'connected' ? detail.dataset.connected : detail.dataset.pending;
      const title = document.getElementById('host-name') || document.getElementById('device-name');
      if (title) title.textContent = state === 'connected' ? title.dataset.connected : 'Connecting';
      const input = document.getElementById('input-status'),
        audio = document.getElementById('audio-status');
      if (input) {
        input.dataset.state = state === 'connected' ? 'ready' : 'pending';
        input.textContent = state === 'connected' ? 'Input ready' : 'Input pending';
      }
      if (audio) audio.textContent = state === 'connected' ? 'Audio on' : 'No audio';
    }
    const drawer = document.getElementById('drawer');
    if (drawer && panel) {
      drawer.hidden = panel === 'none';
      for (const button of document.querySelectorAll('[data-panel]'))
        button.setAttribute('aria-pressed', String(button.dataset.panel === panel));
      for (const tab of document.querySelectorAll('[role=tab]'))
        tab.setAttribute('aria-selected', String(tab.dataset.tab === panel));
      for (const section of document.querySelectorAll('.panel'))
        section.hidden = section.dataset.tab !== panel;
    }
    napper?.draw();
    welcome?.draw();
  }
  addEventListener('message', (event) => {
    if (event.data && typeof event.data === 'object') apply(event.data);
  });
  // The tool buttons open their panels here too, and Android's Disconnect tells the preview page.
  document.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-panel], [data-tab]'),
      close = event.target.closest('#drawer-close');
    if (tool) {
      const name = tool.dataset.panel || tool.dataset.tab;
      apply({ panel: tool.getAttribute('aria-pressed') === 'true' ? 'none' : name });
    }
    if (close) apply({ panel: 'none' });
    if (event.target.closest('#disconnect')) parent.postMessage({ disconnected: true }, '*');
  });
  PixelIcons.render();
  apply(Object.fromEntries(params));
})();
