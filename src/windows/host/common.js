'use strict';
// What every part of the main window (host.html) uses: the bridge to the main process, the settings the window
// saves, the short messages at the bottom of the window, and switching between its three pages.
//
// The window's scripts are classic scripts that share one global scope. They load in the order host.html lists them.
// All of them but the last only declare state and functions; start.js, last, connects them to the page and to the
// main process and starts everything.

/** The functions the main process offers this window (src/preload/host.cjs). */
const api = window.yesMachine;
const $ = (id) => document.getElementById(id);

/**
 * What the main process reports about this computer (api.info()): its name, version, system and account, its
 * private network addresses, its permissions, and the computers and Android devices it knows of. Read when the
 * window opens and again whenever one of these may have changed.
 */
let info;
let noticeTimer = 0;

// --- Saved settings -------------------------------------------------------------------------------------------
// Each setting is a JSON value in the window's local storage, under a key that starts with "ym.".

/** The value saved under `key`, or `fallback` when there is none or it can't be read. */
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Saves `value` under `key`. A failure (storage full or blocked) is ignored. */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// --- Messages -------------------------------------------------------------------------------------------------

/** Shows a short message at the bottom of the window for 7 seconds, or 12 for an error. Empty text clears it. */
function notice(text, error = false) {
  clearTimeout(noticeTimer);
  $('message').textContent = text || '';
  $('message').classList.toggle('error', error);
  if (text)
    noticeTimer = setTimeout(
      () => {
        $('message').textContent = '';
      },
      error ? 12000 : 7000,
    );
}

/** The message of an error from the main process, without the "Error invoking remote method" prefix Electron adds. */
const reason = (error) =>
  String(error?.message || error).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );

// --- The window's three pages ---------------------------------------------------------------------------------
// Home (this computer and the house of devices), the rooftop cat, and Settings. The menu at the side switches
// between them.

// The rooftop cat page shows the original night scene (public/pixel-scene.js). It is created the first time the page
// opens and only drawn while the page is open.
let catScene = null;

/** Shows one page ('home', 'cat' or 'settings') and marks its menu button as the current one. */
function showView(name) {
  for (const view of ['home', 'cat', 'settings']) {
    $(`view-${view}`).hidden = view !== name;
    if (view === name) $(`nav-${view}`).setAttribute('aria-current', 'page');
    else $(`nav-${view}`).removeAttribute('aria-current');
  }
  showCatScene(name === 'cat');
}

/** Starts or pauses the cat scene. It is drawn at the largest whole scale, from 1 to 4, that fits its page. */
function showCatScene(on) {
  if (on && !catScene) {
    catScene = PixelScene.mount($('cat-art'), { mood: 'awake', scale: 3 });
    new ResizeObserver(() =>
      catScene.setScale(
        Math.max(1, Math.min(4, Math.floor(($('cat-scene').clientWidth - 24) / PixelScene.W))),
      ),
    ).observe($('cat-scene'));
  }
  if (catScene) on ? catScene.resume() : catScene.pause();
}

/** Connects the menu buttons, and the sharing card's link to Settings. Called once by start.js. */
function setUpPages() {
  $('nav-home').onclick = () => showView('home');
  $('nav-settings').onclick = () => showView('settings');
  $('nav-cat').onclick = () => showView('cat');
  $('open-settings').onclick = () => showView('settings');
}
