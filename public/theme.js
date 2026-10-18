'use strict';
// Sets night or day on a page before it draws. The desktop app's main window (host.html) and the
// Android app's home screen and Share dialog (home.html, share.html) load this file as a plain,
// blocking <script> in <head>, so it runs before the body is painted. A page last left in day mode
// then opens in day, instead of showing night for a moment before the page's own script turns it
// to day.
//
// The choice is stored under the localStorage key ym.theme as the JSON string 'night' or 'day',
// written by the sun and moon switch (toggleTheme, in src/windows/host/night-and-day.js and in the
// Android app's home/night-and-day.js). Day sets data-theme="light" on <html>, which the stylesheets turn into
// day colors. Night needs nothing, because night is what the stylesheets show by default. On the
// main window and the home screen, the page's own script then keeps data-theme up to date.
try {
  if (JSON.parse(localStorage.getItem('ym.theme')) === 'day')
    document.documentElement.dataset.theme = 'light';
} catch {
  // Storage that can't be read, or a value that isn't JSON, leaves the page at night.
}
