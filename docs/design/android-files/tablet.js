'use strict';
// Prototype only: the device's side, one state at a time, chosen by the preview page. Sharing a photo from another
// app, picking Yes Machine, Yes Machine sending it to the connected computer, and a file from the computer arriving.
(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const COLORS = [
    ['#8ec5ff', '#b39ddb'],
    ['#7fe0a0', '#2e9e5b'],
    ['#ffd27a', '#f08a3c'],
    ['#ff9fb0', '#d9465f'],
    ['#9fb7d6', '#3a6fd8'],
    ['#f0a35e', '#7a4bb5'],
  ];
  for (let i = 0; i < 24; i++) {
    const photo = document.createElement('i');
    const [a, b] = COLORS[(i * 5 + 3) % COLORS.length];
    photo.style.setProperty('--a', a);
    photo.style.setProperty('--b', b);
    if (i === 4) photo.className = 'picked';
    $('photos').append(photo);
  }
  const scrim = Object.assign(document.createElement('div'), { className: 'scrim', hidden: true });
  document.body.insertBefore(scrim, $('send-dialog'));

  function actions(...buttons) {
    $('send-actions').replaceChildren(
      ...buttons.map(([label, kind]) =>
        Object.assign(document.createElement('button'), {
          type: 'button',
          className: kind,
          textContent: label,
        }),
      ),
    );
  }

  function show(state) {
    $('share').hidden = state !== 'share';
    $('heads-up').hidden = state !== 'received';
    const dialog = ['sending', 'sent', 'none'].includes(state);
    scrim.hidden = !dialog && state !== 'share';
    if (dialog) $('send-dialog').setAttribute('open', '');
    else $('send-dialog').removeAttribute('open');
    $('send-progress').hidden = state !== 'sending';
    $('send-dialog').querySelector('.who').hidden = state === 'none';
    if (state === 'sending') {
      $('send-title').textContent = 'Sending to Alejandro’s MacBook Pro';
      $('send-text').textContent = '';
      actions(['Cancel', 'ghost']);
    } else if (state === 'sent') {
      $('send-title').textContent = 'Sent to Alejandro’s MacBook Pro';
      $('send-text').textContent = 'The computer asks where to save it.';
      actions(['OK', 'primary compact']);
    } else if (state === 'none') {
      $('send-title').textContent = 'No computer connected';
      $('send-text').textContent =
        'Open a computer in Yes Machine, or let one control this tablet, then share the file again.';
      actions(['Close', 'ghost'], ['Open Yes Machine', 'primary compact']);
    }
  }
  function theme(name) {
    root.dataset.theme = name === 'day' ? 'light' : 'dark';
  }
  theme(matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night');
  addEventListener('message', ({ data }) => {
    if (data?.tablet) show(data.tablet);
    if (data?.theme) theme(data.theme);
  });
  PixelIcons.render();
  show(new URLSearchParams(location.search).get('state') || 'share');
})();
