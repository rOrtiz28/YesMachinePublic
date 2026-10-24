'use strict';
// The screens a computer can share. Yes Machine shares one at a time: the one chosen on the
// computer or from the viewer, remembered on the computer, or the main screen when the chosen one
// is gone.
//
// main.cjs builds the list from Electron's displays for the host window's screen picker and the
// viewer's map of screens, keeps the choice in shared-screen.json, and uses chooseScreen() to
// decide which display is captured and where input lands.
const { cutText } = require('../network/security.cjs');

// At most this many displays are listed.
const MAX_SCREENS = 16;

/**
 * Lists the screens to choose from.
 *
 * `displays` is Electron's screen.getAllDisplays() and `primaryId` is
 * screen.getPrimaryDisplay().id. Returns the screens as the computer arranges them, left to right
 * then top to bottom, each as:
 * - id: the display's id, as a string;
 * - name: the system's name for it, or "Screen n" (its place in the list) when it has none;
 * - width, height: its size in pixels, for the list;
 * - x, y, w, h: its place in points, for the viewer's map;
 * - main: whether it is the main screen.
 * Entries without a usable size are left out.
 */
function listScreens(displays, primaryId) {
  if (!Array.isArray(displays)) return [];
  return displays
    .slice(0, MAX_SCREENS)
    .filter(
      (display) =>
        display &&
        display.bounds &&
        Number.isFinite(display.bounds.width) &&
        display.bounds.width > 0,
    )
    .map((display) => {
      // Electron measures in points; the scale factor turns them into pixels (1 when unknown).
      const { x, y, width, height } = display.bounds,
        scale = display.scaleFactor > 0 ? display.scaleFactor : 1;
      // The system's name without control characters, at most 60 characters.
      const label = String(display.label || '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim();
      return {
        id: String(display.id),
        name: cutText(label, 60),
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        x,
        y,
        w: width,
        h: height,
        main: String(display.id) === String(primaryId),
      };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((screen, index) => ({ ...screen, name: screen.name || `Screen ${index + 1}` }));
}

/**
 * The screen to share from `screens` (as listScreens() returns them): the one with id `wanted` if
 * it is still there, else the main screen, else the first. Null when there are none.
 */
function chooseScreen(screens, wanted) {
  return (
    screens.find((screen) => screen.id === String(wanted)) ||
    screens.find((screen) => screen.main) ||
    screens[0] ||
    null
  );
}

module.exports = { listScreens, chooseScreen };
