'use strict';
// Starts the home screen. This script runs last, once the others have declared everything: it connects the page to
// Java and its buttons, draws it, and asks Java for this device's state.

setUpBridge();
applyPageTheme(theme);

// --- Buttons and events ---------------------------------------------------------------------------------------

setUpPages();
setUpThemeSwitch();
setUpDeviceList();
setUpConnecting();
setUpGeneralMode();
setUpSettings();
// A session that ended, and the app coming back to the front, when what it shows may be out of date.
api.onEvent((event) => {
  if (event.type === 'viewer-ended') showEnded(event);
  if (event.type === 'resumed') {
    loadInfo().then(probeAll);
    renderCredentials();
    renderTrusted();
  }
});

// --- The page as it opens -------------------------------------------------------------------------------------

PixelIcons.render();
renderThemeToggle();
house = PixelHome.mount($('house-art'), {
  container: $('house'),
  mode: theme,
  ready: catReady,
  onLight: onHouseLight,
  measure: () => ({
    width: $('house').clientWidth,
    height: $('house').clientHeight,
    roofTop: $('house-sky').offsetHeight,
    streetTop: $('house-street').offsetTop,
  }),
});
renderDevices();
renderTrusted();
renderCredentials();
api
  .control()
  .then(renderControl)
  .catch(() => {});
loadInfo().then(probeAll);
// Every 5 seconds: check the listed computers, and follow the device to another network.
setInterval(() => {
  probeAll();
  followNetwork();
}, 5000);
