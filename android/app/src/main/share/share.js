'use strict';
// The dialog for Share, then Yes Machine (share.html), shown over the app the files came from.
// ShareActivity.java sends the files to the computer controlling this device and says how it's
// going: getting a file ready, sending it, sent, or why not. Cancel stops it; OK and Close close
// the dialog; Open Yes Machine opens the app.
//
// The page talks to Java through window.YesMachineShare (ShareActivity's Bridge): state() returns
// the current state as JSON, and cancel(), close() and openApp() do what they say. Java pushes each
// new state by calling window.__share(state). A state has:
//  - state: 'waiting' (just opened), 'preparing' (copying the file into the app first, in advanced
//    mode or when its size is unknown), 'sending', 'sent', 'failed', 'canceled', 'none' (no
//    computer is connected) or 'nothing' (no file was shared);
//  - computer: the computer's name; name: the file's name; size: its size in bytes (-1 when not
//    shown); index and count: which file of how many; percent: how far along it is; detail: why it
//    failed.
(() => {
  const $ = (id) => document.getElementById(id);
  const app = window.YesMachineShare;
  // A size as people read it: GB and MB with one decimal, KB rounded and never below 1 KB.
  const size = (bytes) =>
    bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : bytes >= 1e6
        ? `${(bytes / 1e6).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  // What the dialog explains for the states that send nothing.
  const TEXT = {
    none: 'Yes Machine sends shared files to the computer controlling this device. Let one connect, then share again.',
    nothing:
      'Yes Machine sends files. Text you copy reaches the computer through the shared clipboard.',
  };
  /** Replaces the dialog's buttons. Each is [label, CSS classes, what a click does]. */
  function buttons(...list) {
    $('share-actions').replaceChildren(
      ...list.map(([label, kind, action]) => {
        const button = Object.assign(document.createElement('button'), {
          type: 'button',
          className: kind,
          textContent: label,
        });
        button.addEventListener('click', action);
        return button;
      }),
    );
  }
  /** Shows one state from ShareActivity (described at the top of this file). */
  function render(state) {
    const computer = state.computer || 'the computer',
      count = state.count || 1,
      going = ['waiting', 'preparing', 'sending'].includes(state.state);
    $('share-title').textContent =
      {
        waiting: 'Sending',
        preparing: `Sending to ${computer}`,
        sending: `Sending to ${computer}`,
        sent: count > 1 ? `Sent ${count} files to ${computer}` : `Sent to ${computer}`,
        failed: 'Not sent',
        canceled: 'Canceled',
        none: 'No computer connected',
        nothing: 'Nothing to send',
      }[state.state] || 'Sending';
    // The file: its name, its size and, while several are going, which one this is.
    $('share-file').hidden = !state.name;
    if (state.name) {
      $('file-name').textContent = state.name;
      $('file-detail').textContent = [
        state.size >= 0 ? size(state.size) : '',
        count > 1 && going ? `${state.index} of ${count}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    $('share-progress').hidden = !(state.state === 'preparing' || state.state === 'sending');
    $('progress').value = state.percent || 0;
    $('progress-text').textContent =
      state.state === 'preparing'
        ? `Getting it ready · ${state.percent || 0}%`
        : `Sending · ${state.percent || 0}%`;
    $('share-text').textContent =
      state.state === 'sent'
        ? count > 1
          ? 'The computer asks where to save each one.'
          : 'The computer asks where to save it.'
        : state.state === 'failed'
          ? state.detail || 'The file didn’t go.'
          : TEXT[state.state] || '';
    if (going) buttons(['Cancel', 'ghost', () => app.cancel()]);
    else if (state.state === 'none')
      buttons(
        ['Close', 'ghost', () => app.close()],
        ['Open Yes Machine', 'primary compact', () => app.openApp()],
      );
    else buttons(['OK', 'primary compact', () => app.close()]);
  }
  window.__share = render;
  // Java starts sending while the page loads, and the states it pushed before __share existed were
  // dropped, so the page starts from the current one.
  render(JSON.parse(app.state()));
  window.PixelIcons?.render();
})();
