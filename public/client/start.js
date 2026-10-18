'use strict';
// Starts the viewer. This script runs last, once the others have declared everything: it takes the app's ticket out
// of the address, connects the page's controls, creates the cats, finds out whether the page may read the
// clipboard, and then either starts the session with the app's ticket or shows the welcome screen.

if (appTicket) history.replaceState(null, '', location.pathname);

// --- Buttons and events ---------------------------------------------------------------------------------------

setUpNotices();
setUpSession();
setUpStream();
setUpSignIn();
setUpScreens();
setUpPointer();
setUpKeyboard();
setUpLayout();
setUpClipboard();
setUpFiles();

// --- The page as it opens -------------------------------------------------------------------------------------

// The cats (cats.js).
// The napper lies on the monitor (its feet on art row 22) and its tail hangs past the monitor's right edge at x 34.
// At night the tail is one line, like the rest of the cat; in light mode it is cream with a brown outline.
const napper = pixelCat($('napper'), {
  width: 48,
  height: 48,
  x: 12,
  y: 0,
  mood: 'nap',
  extra: (put, color, ticks, cream) => {
    const swing = [0, 1, 1, 0, -1, -1][Math.floor(ticks / 3) % 6];
    if (!cream) {
      for (let x = 30; x <= 35; x++) put(x, 21, color.catLine);
      for (let y = 22; y < 33; y++) put(35 + (y > 28 ? swing : 0), y, color.catLine);
      put(35 + swing, 33, color.catDim);
      return;
    }
    for (let x = 30; x <= 37; x++) put(x, 20, color.catLine);
    for (let x = 30; x <= 36; x++) put(x, 21, color.catFill);
    put(37, 21, color.catLine);
    for (let y = 22; y < 33; y++) {
      const sway = y > 28 ? swing : 0;
      put(35 + sway, y, color.catLine);
      put(36 + sway, y, color.catFill);
      put(37 + sway, y, color.catLine);
    }
    put(35 + swing, 32, color.catDim);
    put(37 + swing, 32, color.catDim);
    put(36 + swing, 33, color.catLine);
  },
});
const welcomeCat = pixelCat($('welcome-cat'), {
  width: 32,
  height: 32,
  x: 4,
  y: 10,
  mood: 'awake',
});
// Whether this page may read the clipboard: always in the Android app, whose bridge reads it for the page;
// otherwise as the browser's permission says, following its changes.
(async () => {
  if (window.__yesMachineNativeClipboard) {
    clipboardReadable = 'granted';
    return;
  }
  try {
    const status = await navigator.permissions.query({ name: 'clipboard-read' });
    clipboardReadable = status.state;
    status.onchange = () => {
      clipboardReadable = status.state;
    };
  } catch {
    clipboardReadable = false;
  }
})();
renderClipboardMode();

window.PixelIcons?.render();
// With a ticket from an app, the session starts at once. Otherwise the welcome screen shows the sign-in form.
if (appTicket && canConnect()) {
  showScreen('session');
  openSession({ type: 'ticket', ticket: appTicket });
} else showScreen('welcome');
