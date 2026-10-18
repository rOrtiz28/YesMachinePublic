'use strict';
// Prototype only: the viewer's Clipboard panel follows the computer's Settings card beside it.
(() => {
  const NAME = 'Alejandro’s MacBook Pro';
  const TEXT = {
    both: `Shared both ways: what you copy here or on ${NAME} is ready to paste on the other.`,
    to: `Shared to ${NAME} only: what you copy here is ready to paste there.`,
    from: `Shared from ${NAME} only: what you copy there is ready to paste here.`,
    off: `Automatic sharing is off on ${NAME}. Move text with the buttons below.`,
  };
  addEventListener('message', ({ data }) => {
    if (!data?.clipboard) return;
    const line = document.getElementById('clipboard-mode'),
      { on, way } = data.clipboard;
    line.textContent = TEXT[on ? way : 'off'];
    line.classList.toggle('off', !on);
  });
})();
