'use strict';
// Sizes the stand-in desktop and tablet the way client.js and android-viewer.js size the real ones.
(() => {
  const $ = (id) => document.getElementById(id);
  function fitDesktop() {
    const stage = $('desktop-stage'),
      monitor = $('monitor'),
      desktop = $('screen');
    const box = getComputedStyle(stage),
      ratio = 16 / 10;
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
  function fitTablet() {
    const stage = $('stage'),
      screen = $('screen'),
      style = getComputedStyle(stage),
      border = 2 * (parseFloat(getComputedStyle(screen).borderLeftWidth) || 0);
    const width =
      stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - border;
    const height =
      stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - border;
    const scale = Math.max(0, Math.min(width / 2560, height / 1600));
    screen.style.width = `${Math.floor(2560 * scale) + border}px`;
    screen.style.height = `${Math.floor(1600 * scale) + border}px`;
  }
  const fit = $('desktop-stage') ? fitDesktop : fitTablet;
  new ResizeObserver(fit).observe($('desktop-stage') || $('stage'));
  addEventListener('message', () => requestAnimationFrame(fit));
  fit();
})();
