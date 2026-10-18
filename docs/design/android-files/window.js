'use strict';
// Prototype only. The Files drawer in the device's window: files dropped on the window or chosen in the drawer go
// to the device's Download folder, and files the device shares to Yes Machine come back to this computer. The
// transfers are made up; real files can be dragged onto the frame. Hide bars and Full screen work as in the app.
(() => {
  const $ = (id) => document.getElementById(id);
  const session = $('session');
  const DEVICE = 'Alejandro’s Tab A11+';
  let barsHidden = false,
    quiet = 0,
    noticeTimer = 0,
    queue = [],
    sending = false;

  const size = (bytes) =>
    bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : bytes >= 1e6
        ? `${(bytes / 1e6).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

  // Hide bars and Full screen, as in the app.
  function bars() {
    const whole = Boolean(document.fullscreenElement);
    session.classList.toggle('fullscreen', barsHidden || whole);
    session.classList.remove('quiet');
    clearTimeout(quiet);
    if (barsHidden || whole) quiet = setTimeout(() => session.classList.add('quiet'), 3000);
    $('fullscreen-exit').querySelector('.label').textContent = whole
      ? 'Exit full screen'
      : 'Full screen';
  }
  const whole = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await document.documentElement.requestFullscreen().catch(() => {});
  };
  $('bars').addEventListener('click', () => {
    barsHidden = true;
    bars();
  });
  $('bars-show').addEventListener('click', async () => {
    barsHidden = false;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    bars();
  });
  $('fullscreen').addEventListener('click', whole);
  $('fullscreen-exit').addEventListener('click', whole);
  document.addEventListener('fullscreenchange', bars);

  function drawer(open) {
    $('drawer').hidden = !open;
    // frame.js, shared with the earlier previews, hides panels it doesn't know when the drawer closes.
    if (open) {
      $('panel-files').hidden = false;
      $('tab-files').setAttribute('aria-selected', 'true');
    }
    for (const button of document.querySelectorAll('.files-toggle'))
      button.setAttribute('aria-pressed', String(open));
  }
  for (const button of document.querySelectorAll('.files-toggle'))
    button.addEventListener('click', () => drawer($('drawer').hidden));
  $('drawer-close').addEventListener('click', () => drawer(false));

  function notice(text, show = false) {
    $('notice-text').textContent = text;
    $('notice-show').hidden = !show;
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      $('notice').hidden = true;
    }, 6000);
  }

  // One line per file, newest first, as the computer viewer lists what it receives.
  function row(name, detail, show) {
    const line = document.createElement('div');
    line.className = 'download';
    line.innerHTML =
      '<span class="icon" data-icon="file"></span><span><b></b><small></small></span>';
    line.querySelector('b').textContent = name;
    line.querySelector('small').textContent = detail;
    if (show) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-button';
      button.textContent = 'Show';
      line.append(button);
    }
    $('transfers').prepend(line);
    while ($('transfers').children.length > 5) $('transfers').lastElementChild.remove();
    PixelIcons.render(line);
  }

  function progress(name, percent) {
    $('file-progress').hidden = false;
    $('file-progress').value = percent;
    $('file-status').textContent = `Sending ${name} · ${percent}%`;
  }

  // Files go one after another; several dropped at once wait their turn.
  async function send(files) {
    queue.push(...files);
    if (sending) return;
    sending = true;
    while (queue.length) {
      const file = queue.shift();
      for (let percent = 0; percent <= 100; percent += 5) {
        progress(file.name, percent);
        if ($('drawer').hidden) notice(`Sending ${file.name} to ${DEVICE} · ${percent}%`);
        await new Promise((resolve) => setTimeout(resolve, 70));
      }
      row(file.name, `${size(file.size)} · in the device’s Download folder`);
      $('file-progress').hidden = true;
      $('file-status').textContent = `${file.name} is in the device’s Download folder.`;
      if ($('drawer').hidden) notice(`${file.name} is in the device’s Download folder.`);
    }
    sending = false;
  }
  $('file-input').addEventListener('change', () => {
    send([...$('file-input').files].map(({ name, size }) => ({ name, size })));
    $('file-input').value = '';
  });

  // Dragging files over any part of the window shows where they go; dropping sends them.
  let depth = 0;
  document.addEventListener('dragenter', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      depth++;
      $('drop-target').hidden = false;
    }
  });
  document.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      $('drop-target').hidden = true;
    }
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    $('drop-target').hidden = true;
    const files = [...(event.dataTransfer?.files || [])].map(({ name, size }) => ({ name, size }));
    if (files.length) send(files);
  });

  // The states the preview page shows, one at a time.
  function show(state) {
    drawer(false);
    $('drop-target').hidden = true;
    $('notice').hidden = true;
    $('file-progress').hidden = true;
    $('file-status').textContent = 'Ready when you are.';
    $('transfers').replaceChildren();
    row('IMG_2038.jpg', '3.1 MB · from the device · saved in Downloads', true);
    row('report.pdf', '2.4 MB · in the device’s Download folder');
    if (state === 'panel') drawer(true);
    if (state === 'drag') $('drop-target').hidden = false;
    if (state === 'sending') {
      drawer(true);
      progress('Trip photos.zip', 45);
    }
    if (state === 'received') {
      drawer(true);
      row('IMG_2041.jpg', '2.8 MB · from the device · saved in Downloads', true);
      notice('Saved IMG_2041.jpg in Downloads.', true);
    }
  }
  addEventListener('message', ({ data }) => {
    if (data?.files) show(data.files);
  });
  bars();
  show('closed');
})();
