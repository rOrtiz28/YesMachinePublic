'use strict';
// Prototype only: the clipboard card's switch and its three-way slider. The preview page hears every change, so the
// viewer beside it shows what the person at the other device would read.
(() => {
  const $ = (id) => document.getElementById(id);
  const WAYS = ['to', 'both', 'from'];
  let on = true,
    way = 'both';
  function render() {
    $('setting-clipboard').setAttribute('aria-checked', String(on));
    $('clipboard-way').setAttribute('aria-disabled', String(!on));
    $('clipboard-track').style.setProperty('--stop', WAYS.indexOf(way));
    for (const button of document.querySelectorAll('[data-way]'))
      button.setAttribute('aria-checked', String(button.dataset.way === way));
    parent.postMessage({ clipboard: { on, way } }, '*');
  }
  $('setting-clipboard').addEventListener('click', () => {
    on = !on;
    render();
  });
  for (const button of document.querySelectorAll('[data-way]'))
    button.addEventListener('click', () => {
      way = button.dataset.way;
      render();
    });
  // A click on the track goes to the nearest stop.
  $('clipboard-track').addEventListener('click', (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    way = WAYS[Math.max(0, Math.min(2, Math.round(((event.clientX - box.left) / box.width) * 2)))];
    render();
  });
  for (const other of document.querySelectorAll('.switch:not(#setting-clipboard)'))
    other.addEventListener('click', () =>
      other.setAttribute('aria-checked', String(other.getAttribute('aria-checked') !== 'true')),
    );
  render();
})();
