'use strict';
// The browser viewer: the page a browser opens to see and control a computer that shares its screen with Yes
// Machine. The computer's own server (src/main/sharing/server.cjs) serves it, and the desktop app's viewer windows
// and the Android app show the same page. It has two screens: the welcome screen, with the sign-in form, and the
// session, with the computer's screen in a monitor drawing, a tool bar, a status strip and a tool drawer.
//
// client.html loads its scripts in this order, as classic scripts that share one global scope: common.js,
// cats.js, session.js, stream.js, sign-in.js, screens.js, pointer.js, keyboard.js, clipboard.js, files.js,
// layout.js and start.js. All of them but start.js only declare state and functions; start.js, last, connects them
// to the page and starts the viewer.
//
// This file holds what every part uses: the page's main elements, the size limits, cutting names, notices, the
// status line, icons, and switching between the two screens.

const $ = (id) => document.getElementById(id);
// The video of the computer's screen, the area around the monitor drawing, and the session screen.
const video = $('remote-video');
const stage = $('desktop-stage');
const session = $('session');
// The screen inside the monitor drawing, which holds the video, and the monitor around it.
const desktop = $('screen');
const monitor = $('monitor');
// The largest file either way, the size of each piece of a file sent, and the most text a message may carry.
const MAX_FILE = 10 * 1024 * 1024 * 1024; // 10 GB
const CHUNK_SIZE = 48 * 1024;
const MAX_TEXT = 1024 * 1024;
let noticeTimer = null;

// --- Names ----------------------------------------------------------------------------------------------------

/**
 * text cut to at most length UTF-16 units, as slice() counts, without leaving half a character behind. Most emoji,
 * and every other character outside the Basic Multilingual Plane, take two units (a surrogate pair); a cut between
 * the two drops the first.
 */
function cutText(text, length) {
  return text.slice(0, length).replace(/[\ud800-\udbff]$/, '');
}

// --- Notices and the status line ------------------------------------------------------------------------------

/** A notice at the bottom of the page, cut to 600 characters. It goes away after 7 seconds unless it is sticky. */
function showNotice(message, error = false, sticky = false) {
  clearTimeout(noticeTimer);
  $('notice-text').textContent = String(message).slice(0, 600);
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
  if (!sticky)
    noticeTimer = setTimeout(() => {
      $('notice').hidden = true;
    }, 7000);
}

/** The connection line in the session's status strip, and the session's state: 'pending', 'connected' or 'offline'. */
function sessionStatus(message, state = 'pending') {
  $('connection-detail').textContent = message;
  session.dataset.state = state;
}

/** Draws a pixel icon (public/pixel-icons.js) inside a button's .icon. */
function setIcon(button, name) {
  const icon = window.PixelIcons?.svg(name);
  if (icon) button.querySelector('.icon').replaceChildren(icon);
}

// --- The two screens ------------------------------------------------------------------------------------------

/**
 * Shows the welcome screen or the session ('welcome' or 'session'). Only the cat of the screen shown moves (cats.js).
 * Back on the welcome screen, the bars come back.
 */
function showScreen(name) {
  $('welcome').hidden = name !== 'welcome';
  session.hidden = name !== 'session';
  welcomeCat.run(name === 'welcome');
  napper.run(name === 'session');
  if (name === 'welcome') {
    welcomeCat.setMood('awake');
    document.title = 'Yes Machine';
    barsHidden = false;
    syncFullscreen();
  } else fitScreen();
}

/** Connects the notice's close button. Called once by start.js. */
function setUpNotices() {
  $('notice-dismiss').addEventListener('click', () => {
    clearTimeout(noticeTimer);
    $('notice').hidden = true;
  });
}
