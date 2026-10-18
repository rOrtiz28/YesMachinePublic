'use strict';
// Test only. The windows the latency harness shows on the host, and that pattern/ shows on its own on a computer whose
// own Yes Machine shares, such as a Mac: a small one that turns black or white under the mouse, which a viewer times,
// and, with motion, a large one that keeps changing so the encoder works the whole time. Each logs where the small
// window sits, for measure.cjs: "PATTERN" and its bounds and the screen's, in the screen's points.
// Used by harness/main.cjs and pattern/main.cjs. Each page is a data: URL, so the windows load nothing else.

// Black when the mouse is in the left half, white in the right half. The cursor is hidden over it.
const PATTERN = `<!doctype html><body style="margin:0;height:100vh;background:#000;cursor:none"><script>
addEventListener('mousemove', e => { document.body.style.background = e.clientX < innerWidth / 2 ? '#000' : '#fff'; });
</script></body>`;
// Something that keeps changing, like scrolling a long page, so the encoder works the whole time.
const MOTION = `<!doctype html><body style="margin:0;overflow:hidden;background:#fff;font:15px/22px sans-serif"><canvas id=c></canvas><script>
const c = document.getElementById('c'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
const words = 'the quick brown fox jumps over the lazy dog while the cat watches the cars go by on the street'.split(' ');
const lines = Array.from({length: 400}, (_, i) => Array.from({length: 14}, (_, j) => words[(i * 7 + j * 3) % words.length]).join(' '));
let offset = 0;
(function frame() {
  offset = (offset + 3) % (lines.length * 22);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < c.height / 22 + 2; i++) {
    const n = Math.floor(offset / 22) + i;
    x.fillStyle = n % 9 === 0 ? '#1d6fd1' : '#222';
    x.fillText(lines[n % lines.length], 20, i * 22 - offset % 22 + 18);
  }
  const t = performance.now() / 1000;
  const g = x.createLinearGradient(0, 0, c.width, 0);
  g.addColorStop(0, 'hsl(' + (t * 40 % 360) + ',70%,55%)'); g.addColorStop(1, 'hsl(' + ((t * 40 + 180) % 360) + ',70%,55%)');
  x.fillStyle = g; x.fillRect(c.width - 260 + Math.sin(t) * 40, 40 + Math.cos(t * 1.3) * 30, 200, 140);
  requestAnimationFrame(frame);
})();
</script></body>`;

// Like a video playing: color washes and moving round shapes over the whole window, every frame.
const HEAVY = `<!doctype html><body style="margin:0;overflow:hidden;background:#000"><canvas id=c></canvas><script>
const c = document.getElementById('c'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
const balls = Array.from({length: 40}, (_, i) => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: 30 + Math.random() * 90, vx: (Math.random() - .5) * 9, vy: (Math.random() - .5) * 9, h: i * 37 % 360 }));
(function frame(now) {
  const t = now / 1000;
  const g = x.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, 'hsl(' + (t * 30 % 360) + ',60%,40%)'); g.addColorStop(.5, 'hsl(' + ((t * 30 + 120) % 360) + ',60%,50%)'); g.addColorStop(1, 'hsl(' + ((t * 30 + 240) % 360) + ',60%,35%)');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  for (const b of balls) {
    b.x += b.vx; b.y += b.vy; if (b.x < 0 || b.x > c.width) b.vx *= -1; if (b.y < 0 || b.y > c.height) b.vy *= -1;
    const r = x.createRadialGradient(b.x - b.r / 3, b.y - b.r / 3, 4, b.x, b.y, b.r);
    r.addColorStop(0, 'hsl(' + ((b.h + t * 50) % 360) + ',90%,75%)'); r.addColorStop(1, 'hsla(' + ((b.h + t * 50) % 360) + ',90%,30%,0.85)');
    x.fillStyle = r; x.beginPath(); x.arc(b.x, b.y, b.r, 0, 7); x.fill();
  }
  requestAnimationFrame(frame);
})(0);
</script></body>`;

// On a Mac, also over an app in full screen, which has a space of its own.
const float = (window) => {
  if (process.platform === 'darwin')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
};

/**
 * Shows the windows on the primary display, on top of everything but without taking the focus: the 400 × 300 color
 * window near the top left of the work area and, with `motion`, a 1200 × 800 busy window to its right, which shows
 * MOTION, or HEAVY when `heavy` is set as well. BrowserWindow and screen are the caller's, from Electron. Once the
 * color window has shown for 1.5 seconds, its place is logged as PATTERN.
 */
function showWindows({ BrowserWindow, screen }, { motion = false, heavy = false } = {}) {
  const area = screen.getPrimaryDisplay().workArea;
  const pattern = new BrowserWindow({
    x: area.x + 40,
    y: area.y + 40,
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    backgroundColor: '#000000',
    webPreferences: { sandbox: true },
  });
  float(pattern);
  pattern.loadURL('data:text/html,' + encodeURIComponent(PATTERN));
  pattern.once('ready-to-show', () => {
    pattern.showInactive();
    setTimeout(
      () =>
        console.log(
          'PATTERN ' +
            JSON.stringify({
              window: pattern.getBounds(),
              display: screen.getPrimaryDisplay().bounds,
            }),
        ),
      1500,
    );
  });
  if (motion) {
    const busy = new BrowserWindow({
      x: area.x + 480,
      y: area.y + 40,
      width: 1200,
      height: 800,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      show: false,
      backgroundColor: '#ffffff',
      // Keep drawing every frame although the window never has the focus.
      webPreferences: { sandbox: true, backgroundThrottling: false },
    });
    float(busy);
    busy.loadURL('data:text/html,' + encodeURIComponent(heavy ? HEAVY : MOTION));
    busy.once('ready-to-show', () => busy.showInactive());
  }
}

module.exports = { PATTERN, MOTION, HEAVY, showWindows };
