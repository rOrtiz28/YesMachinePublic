'use strict';
// How the session fills the window: the computer's screen sized to its shape inside the monitor drawing, Hide bars
// and full screen, and the tool drawer beside the screen.

// Hide bars takes away the tool bar and the status strip, so the desktop fills the window; full screen does the same
// over the whole screen. Both leave a small bar at the top that fades after a few seconds, with Show bars to bring
// everything back and Full screen to switch between the two. Leaving full screen goes back to where it started.
// Full screen covers the whole page, so the tool drawer and notices stay available; where the browser has no full
// screen API, hiding the bars is the closest.
let barsHidden = false;
let quietTimer = null;
// The drawer's tabs, one for each panel.
const tabs = [...document.querySelectorAll('.drawer-tabs [role=tab]')];

// --- The screen's size ----------------------------------------------------------------------------------------

/**
 * Sizes the screen to the computer's shape (16:10 until the video says) within the space the monitor drawing and the
 * cat leave. In full screen and with the bars hidden, the style sheet sizes it instead.
 */
function fitScreen() {
  if (session.hidden) return;
  if (session.classList.contains('fullscreen')) {
    desktop.style.width = desktop.style.height = '';
    return;
  }
  const ratio =
    video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 10;
  const box = getComputedStyle(stage);
  const width =
    stage.clientWidth -
    parseFloat(box.paddingLeft) -
    parseFloat(box.paddingRight) -
    (monitor.offsetWidth - desktop.offsetWidth);
  const height =
    stage.clientHeight -
    parseFloat(box.paddingTop) -
    parseFloat(box.paddingBottom) -
    (monitor.offsetHeight - desktop.offsetHeight);
  const fitted = Math.max(0, Math.min(width, height * ratio));
  desktop.style.width = `${Math.floor(fitted)}px`;
  desktop.style.height = `${Math.floor(fitted / ratio)}px`;
}

// --- Hide bars and full screen --------------------------------------------------------------------------------

/** Shows the page as full screen or hidden bars say, and the buttons' labels to match. */
function syncFullscreen() {
  const whole = Boolean(document.fullscreenElement),
    full = whole || barsHidden;
  session.classList.toggle('fullscreen', full);
  session.classList.remove('quiet');
  clearTimeout(quietTimer);
  if (full) quietTimer = setTimeout(() => session.classList.add('quiet'), 3000);
  $('fullscreen-button').setAttribute('aria-label', whole ? 'Exit full screen' : 'Full screen');
  $('fullscreen-exit').setAttribute('aria-pressed', String(whole));
  $('fullscreen-exit').querySelector('.label').textContent = whole
    ? 'Exit full screen'
    : 'Full screen';
  fitScreen();
}

/** Enters or leaves full screen. Where the browser can't, it hides the bars instead. */
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    barsHidden = true;
    syncFullscreen();
  }
  video.focus({ preventScroll: true });
}

/** Hide bars (false) and Show bars (true). Showing the bars also leaves full screen. */
function showBars(show) {
  barsHidden = !show;
  if (show && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  syncFullscreen();
  video.focus({ preventScroll: true });
}

// --- The tool drawer ------------------------------------------------------------------------------------------

/**
 * Shows one of the drawer's panels ('files', 'clipboard' or 'keyboard'), or closes the drawer (null). The tool bar's
 * buttons open it and close it again. Leaving the Keyboard panel lets go of its modifier keys.
 */
function showPanel(name, focus = true) {
  const open = name !== null;
  if ($('drawer').hidden && !open) return;
  $('drawer').hidden = !open;
  document
    .querySelectorAll('[data-panel]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.panel === name)),
    );
  document.querySelectorAll('.drawer-tabs [role=tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    tab.tabIndex = tab.dataset.tab === name ? 0 : -1;
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.hidden = panel.dataset.tab !== name;
  });
  if (name !== 'keyboard') releaseInput();
  if (!focus) return;
  if (name === 'keyboard') $('remote-text').focus();
  else if (open) document.querySelector(`.drawer-tabs [data-tab="${name}"]`).focus();
  else video.focus({ preventScroll: true });
}

/** Connects the bars, full screen and the drawer, and fits the screen as sizes change. Called once by start.js. */
function setUpLayout() {
  $('fullscreen-button').addEventListener('click', toggleFullscreen);
  $('fullscreen-exit').addEventListener('click', toggleFullscreen);
  $('bars-button').addEventListener('click', () => showBars(false));
  $('bars-show').addEventListener('click', () => showBars(true));
  document.addEventListener('fullscreenchange', () => {
    syncFullscreen();
    releaseInput();
  });
  document.querySelectorAll('[data-panel]').forEach((button) => {
    button.addEventListener('click', () =>
      showPanel(button.getAttribute('aria-pressed') === 'true' ? null : button.dataset.panel),
    );
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showPanel(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      showPanel(tabs[(index + step + tabs.length) % tabs.length].dataset.tab);
    });
  });
  $('drawer-close').addEventListener('click', () => showPanel(null));
  $('drawer').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      showPanel(null);
    }
  });
  new ResizeObserver(fitScreen).observe(stage);
  video.addEventListener('resize', fitScreen);
  video.addEventListener('loadedmetadata', fitScreen);
}
