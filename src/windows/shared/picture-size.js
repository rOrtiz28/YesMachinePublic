'use strict';
// How large the shared screen is captured: as large as the viewer shows it, in the viewer's own device pixels, and
// never larger than the screen itself. A phone or a small window gets a small picture, which is cheap to send and
// sharp for its size, and a large window on a large screen gets the whole screen at its own size, so text stays
// crisp. The viewer reports its picture area in 'view' messages once the computer's status says it takes them
// (`view: true`); a viewer that doesn't, such as the Android app before 1.1, gets what every picture was before, at
// most 1920×1200. The main window's page uses it (sharing.js and viewer-connection.js); the tests load it in Node.
(() => {
  // The area assumed until the viewer reports its own.
  const DEFAULT_VIEW = { width: 1920, height: 1200 };
  // The largest picture sent, whatever the viewer and the screen: about 4K. A larger frame costs too much to encode
  // 60 times a second.
  const LARGEST = { width: 3840, height: 2400 };
  // The range a reported side must be in.
  const SMALLEST_SIDE = 64,
    LARGEST_SIDE = 16384;

  /** The area in a 'view' message, as { width, height }, or null unless both are whole numbers in range. */
  function viewFrom(message) {
    const width = message?.width,
      height = message?.height;
    const fits = (side) => Number.isInteger(side) && side >= SMALLEST_SIDE && side <= LARGEST_SIDE;
    return fits(width) && fits(height) ? { width, height } : null;
  }

  /**
   * The capture constraints for a viewer that shows the picture in `view`: 60 frames a second, and a size within
   * both the view and LARGEST. The capture keeps the screen's shape and never enlarges it, so a screen smaller than
   * the view comes at its own size.
   */
  function captureFor(view = DEFAULT_VIEW) {
    return {
      frameRate: { ideal: 60, max: 60 },
      width: { max: Math.min(view.width, LARGEST.width) },
      height: { max: Math.min(view.height, LARGEST.height) },
    };
  }

  const api = { DEFAULT_VIEW, LARGEST, viewFrom, captureFor };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PictureSize = api;
})();
