'use strict';
// What every part of the home screen uses: the page's elements, the settings it saves, the device's information,
// the short messages at the bottom, and the three pages (Home, the rooftop cat, Settings).

const $ = (id) => document.getElementById(id);
// What Java reports about this device: the app's version, and the network it is on ({ address, prefix, kind }).
let info = null;
let noticeTimer = 0;

// --- Saved settings -------------------------------------------------------------------------------------------
// Each setting is a JSON value in the page's local storage, under a key that starts with "ym.".

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

// --- This device ----------------------------------------------------------------------------------------------

/** Asks Java about this device again and shows it: the version in Settings, the network pill, and the list. */
async function loadInfo() {
  try {
    info = await api.info();
    $('version').textContent = `v${info.version}`;
    $('about-version').textContent = info.version;
    renderNetworkPill();
    lastDevices = '';
    renderDevices();
  } catch (e) {
    notice(e.message, true);
  }
}

// --- Messages -------------------------------------------------------------------------------------------------

/** Shows a short message at the bottom of the screen for 7 seconds, or 12 for an error. Empty text clears it. */
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

/** A dialog with a title and a paragraph, for explanations that need more room than a message. */
function showInfo(title, text) {
  $('info-title').textContent = title;
  $('info-text').textContent = text;
  if (!$('info-dialog').open) $('info-dialog').showModal();
}

// --- The three pages ------------------------------------------------------------------------------------------

// The rooftop cat page shows the original night scene. It is drawn only while the page is open, at the
// largest whole scale that fits.
let catScene = null;

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

/** Shows one page ('home', 'cat' or 'settings') and marks its menu button as the current one. */
function showView(name) {
  for (const view of ['home', 'cat', 'settings']) {
    $(`view-${view}`).hidden = view !== name;
    if (view === name) $(`nav-${view}`).setAttribute('aria-current', 'page');
    else $(`nav-${view}`).removeAttribute('aria-current');
  }
  showCatScene(name === 'cat');
}

/** Connects the menu, the information dialog's button and Android's back button. Called once by start.js. */
function setUpPages() {
  $('nav-home').onclick = () => showView('home');
  $('nav-settings').onclick = () => showView('settings');
  $('nav-cat').onclick = () => showView('cat');
  $('info-ok').onclick = () => $('info-dialog').close();
  // Android's back button: close an open dialog, or go from Settings back home. Returns false to let the app close.
  window.__homeBack = () => {
    const open = [...document.querySelectorAll('dialog')].find((dialog) => dialog.open);
    if (open) {
      open.close();
      return true;
    }
    if ($('view-home').hidden) {
      showView('home');
      return true;
    }
    return false;
  };
}
