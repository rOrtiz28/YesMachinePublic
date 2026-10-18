'use strict';
// Prototype only. Hide bars takes the window's bars away, with what they say, so the screen fills the window: full
// screen's layout, inside the window. The small bar at the top, which fades after a few seconds, brings the bars back
// or takes the whole screen; Full screen in the main bar takes the whole screen at once, as it does now.
(() => {
  const $ = (id) => document.getElementById(id);
  const session = $('session');
  let barsHidden = false,
    quiet = 0;
  function render() {
    const whole = Boolean(document.fullscreenElement);
    session.classList.toggle('fullscreen', barsHidden || whole);
    session.classList.remove('quiet');
    clearTimeout(quiet);
    if (barsHidden || whole) quiet = setTimeout(() => session.classList.add('quiet'), 3000);
    const exit = $('fullscreen-exit');
    exit.querySelector('.label').textContent = whole ? 'Exit full screen' : 'Full screen';
    exit.setAttribute('aria-pressed', String(whole));
    parent.postMessage({ clean: barsHidden, whole }, '*');
  }
  const whole = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await document.documentElement.requestFullscreen().catch(() => {});
  };
  $('bars').addEventListener('click', () => {
    barsHidden = true;
    render();
  });
  $('fs-bars').addEventListener('click', async () => {
    barsHidden = false;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    render();
  });
  $('fullscreen').addEventListener('click', whole);
  $('fullscreen-exit').addEventListener('click', whole);
  document.addEventListener('fullscreenchange', render);
  addEventListener('message', ({ data }) => {
    if (data && 'hideBars' in data) {
      barsHidden = data.hideBars;
      render();
    }
  });
  render();
})();
