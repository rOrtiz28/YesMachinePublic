'use strict';
// The shared clipboard, set in Settings: on or off, and which way. Both ways unless chosen otherwise.
//
// Text copied on this computer goes to the viewer as it changes: the main process watches the clipboard
// (src/main/control/clipboard-watch.cjs) and tells this window ('clipboard' events, see start.js). The viewer's
// clipboard comes here when the viewer returns to its window or pastes (viewer-connection.js). The setting is saved
// as ym.clipboard, and the viewer hears it with the status.

// The ways, in the order of the slider's stops: to this computer only, both ways, from this computer only.
const CLIPBOARD_WAYS = ['to', 'both', 'from'];
let clipboardSetting = ((stored) => ({
  on: stored?.on !== false,
  way: CLIPBOARD_WAYS.includes(stored?.way) ? stored.way : 'both',
}))(read('ym.clipboard', null));
// The setting as one word ('to', 'both', 'from' or 'off'), and whether text may come here or go from here.
const clipboardMode = () => (clipboardSetting.on ? clipboardSetting.way : 'off');
const clipboardToHere = () => ['both', 'to'].includes(clipboardMode()),
  clipboardFromHere = () => ['both', 'from'].includes(clipboardMode());

/** The switch and the slider in Settings. */
function renderClipboardSetting() {
  $('setting-clipboard').setAttribute('aria-checked', String(clipboardSetting.on));
  $('clipboard-way').setAttribute('aria-disabled', String(!clipboardSetting.on));
  $('clipboard-track').style.setProperty('--stop', CLIPBOARD_WAYS.indexOf(clipboardSetting.way));
  for (const button of document.querySelectorAll('#clipboard-way [data-way]'))
    button.setAttribute('aria-checked', String(button.dataset.way === clipboardSetting.way));
}

/** Changes the setting ({ on } or { way }), saves it, and tells the viewer and the main process. */
function setClipboard(change) {
  clipboardSetting = { ...clipboardSetting, ...change };
  write('ym.clipboard', clipboardSetting);
  renderClipboardSetting();
  sendStatus();
  syncClipboardWatch();
}

/** This computer's clipboard is watched only while a viewer is connected and may receive it. */
function syncClipboardWatch() {
  api.watchClipboard(channel?.readyState === 'open' && clipboardFromHere()).catch(() => {});
}

/** Connects the switch and the slider. Called once by start.js. */
function setUpClipboard() {
  $('setting-clipboard').onclick = () => setClipboard({ on: !clipboardSetting.on });
  for (const button of document.querySelectorAll('#clipboard-way [data-way]'))
    button.onclick = () => setClipboard({ way: button.dataset.way });
  // A click on the track goes to the nearest stop.
  $('clipboard-track').onclick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    setClipboard({
      way: CLIPBOARD_WAYS[
        Math.max(0, Math.min(2, Math.round(((event.clientX - box.left) / box.width) * 2)))
      ],
    });
  };
}
