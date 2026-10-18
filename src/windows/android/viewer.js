'use strict';
// The Android window: the desktop app's window that shows an Android device and controls it, in either mode.
//
// The main process (src/main/android/windows.cjs) opens one window per device and talks to it through
// window.device (src/preload/android.cjs): the device's messages arrive through device.onStream, and input goes back
// through device.touch, device.key, device.text and the others. The messages come from advanced mode's stream server
// (android/stream) or from the Yes Machine app in general mode; src/main/android/protocol.cjs describes them.
//
// - The picture: H.264 frames are decoded in hardware (WebCodecs) and drawn on a canvas the moment they are ready,
//   with no buffer, so the picture stays as close to the device as it can.
// - Sound: 48 kHz stereo PCM, played through an audio worklet with a short buffer.
// - The mouse acts as a finger: the left button touches, the right one is Back and the middle one Home; the wheel
//   scrolls. What is typed reaches the device as text, or as key presses for keys that aren't characters.
// - The bar has the device's Back, Home and Recents buttons, its on-screen keyboard switch, sound, screenshot, files,
//   hide bars and full screen.
// - Files dropped on the window go to the device's Download folder, and files the device shares arrive here.
// - The clipboard is shared as Settings in the main window says.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('screen'),
    session = $('session'),
    typing = $('typing');
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const { device } = window;
  // The video decoder and the codec configuration it was set up with (the stream's sequence and picture parameter
  // sets). The frames drawn since the window opened, as counted a second ago, and the video bytes received this
  // second, for the rate shown in the bar. Whether a picture has arrived. How the device is reached ('usb', 'wifi',
  // or 'network' in general mode), and its name.
  let decoder = null,
    codecConfig = null,
    framesDrawn = 0,
    framesCounted = 0,
    bytesThisSecond = 0,
    connected = false,
    transport = '',
    deviceName = '';

  /** The line under the device's name in the bar, and the session's state: 'pending', 'connected' or 'offline'. */
  function showStatus(text, state = 'pending') {
    $('detail').textContent = text;
    session.dataset.state = state;
  }

  // --- The picture ----------------------------------------------------------------------------------------------

  /**
   * Sizes the screen to keep its shape and fill as much of the window as it can, in either orientation. Its size
   * includes the frame around it (border-box), so the frame is added back after scaling.
   */
  function fitScreen() {
    const stage = $('stage'),
      style = getComputedStyle(stage),
      border = 2 * (parseFloat(getComputedStyle(canvas).borderLeftWidth) || 0);
    const width =
      stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - border;
    const height =
      stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - border;
    const scale = Math.max(0, Math.min(width / canvas.width, height / canvas.height));
    canvas.style.width = `${Math.floor(canvas.width * scale) + border}px`;
    canvas.style.height = `${Math.floor(canvas.height * scale) + border}px`;
  }
  new ResizeObserver(fitScreen).observe($('stage'));

  /**
   * The codec string for the decoder, such as avc1.42c028: the profile and level bytes of the sequence parameter set
   * (the NAL unit of type 7) in the configuration the device sent.
   */
  function codecString(data) {
    for (let i = 0; i + 6 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
        const hex = (value) => value.toString(16).padStart(2, '0');
        return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
      }
    }
    throw Error('The device sent no sequence parameter set.');
  }

  /**
   * Sets up a new decoder for the configuration the device just sent (it sends one when the stream starts and when
   * the screen's size changes). Each decoded frame is drawn at once; the first one marks the session connected.
   */
  function configure() {
    if (decoder && decoder.state !== 'closed') decoder.close();
    decoder = new VideoDecoder({
      output(frame) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          fitScreen();
        }
        context.drawImage(frame, 0, 0);
        frame.close();
        framesDrawn++;
        if (!connected) {
          connected = true;
          $('waiting').hidden = true;
          showStatus(
            transport === 'usb' ? 'Connected by USB cable' : 'Connected over Wi-Fi',
            'connected',
          );
          typing.focus({ preventScroll: true });
        }
      },
      error(error) {
        showStatus(`The video stopped: ${error.message}`, 'offline');
      },
    });
    decoder.configure({
      codec: codecString(codecConfig),
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    });
  }

  // --- Sound ----------------------------------------------------------------------------------------------------
  // The device's sound, when it sends some: 48 kHz stereo PCM, played with about 40 to 100 ms in hand, enough to ride
  // out the network's unevenness while staying close to the picture. The speaker in the bar mutes it here, and this
  // computer remembers that (ym.androidMuted); the sound keeps arriving, so it comes back at once.

  // The worklet that plays the sound, once it is loaded (a promise), the gain that mutes it, and whether it is muted.
  let sound = null,
    volume = null,
    muted = false;
  try {
    muted = JSON.parse(localStorage.getItem('ym.androidMuted')) === true;
  } catch {
    /* sound on */
  }

  /**
   * Plays a piece of the device's sound, starting the audio worklet (src/windows/shared/pcm-worklet.js) the first
   * time.
   */
  async function playSound(data) {
    if (!sound) {
      const audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      sound = audioContext.audioWorklet.addModule('../shared/pcm-worklet.js').then(() => {
        // The buffer: at most 4800 frames (100 ms) before the oldest are dropped down to 2400, and 1920 (40 ms) to
        // gather before playing.
        const player = new AudioWorkletNode(audioContext, 'pcm-player', {
          outputChannelCount: [2],
          processorOptions: { most: 4800, keep: 2400, start: 1920 },
        });
        volume = audioContext.createGain();
        volume.gain.value = muted ? 0 : 1;
        player.connect(volume).connect(audioContext.destination);
        return player;
      });
    }
    const player = await sound;
    const bytes = new Uint8Array(data);
    player.port.postMessage(bytes.buffer, [bytes.buffer]);
  }

  // --- Messages from the device ---------------------------------------------------------------------------------

  device.onStream((message) => {
    if (message.type === 'sound') {
      playSound(message.data).catch(() => {});
      return;
    }
    if (message.type === 'file') {
      onFileEvent(message);
      return;
    }
    // Whether the device's side can exchange files (older versions of the app can't).
    if (message.type === 'files-ready' || message.type === 'files-unavailable') {
      filesReady = message.type === 'files-ready';
      renderFilesReady();
      return;
    }
    if (message.type === 'device') {
      ({ name: deviceName, transport } = message);
      $('device-name').textContent = deviceName;
      for (const label of document.querySelectorAll('.device-label'))
        label.textContent = deviceName;
      document.title = `${deviceName} · Yes Machine`;
      showStatus(`${message.system} · starting its screen…`);
    } else if (message.type === 'asking') {
      // General mode: the device asks its person before it lets this computer in.
      $('waiting-title').textContent = `Waiting for ${deviceName}`;
      $('waiting-hint').textContent = 'On the device, tap Allow to let this computer in.';
      showStatus('Waiting for permission on the device…');
    } else if (message.type === 'video') {
      const data = new Uint8Array(message.data);
      // Flag 2 (MediaCodec's codec config): the parameter sets, which start a new decoder.
      if (message.flags & 2) {
        codecConfig = data;
        configure();
        return;
      }
      if (!decoder || decoder.state !== 'configured') return;
      // Flag 1: a key frame. The decoder gets the parameter sets again in front of it.
      const key = (message.flags & 1) !== 0;
      let chunk = data;
      if (key) {
        chunk = new Uint8Array(codecConfig.length + data.length);
        chunk.set(codecConfig);
        chunk.set(data, codecConfig.length);
      }
      bytesThisSecond += data.length;
      decoder.decode(
        new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: message.pts, data: chunk }),
      );
    }
  });

  // Frames per second and megabits per second, in the bar, once a second.
  setInterval(() => {
    const fps = framesDrawn - framesCounted;
    framesCounted = framesDrawn;
    $('rate').textContent = connected
      ? `${fps} fps · ${((bytesThisSecond * 8) / 1e6).toFixed(1)} Mbps`
      : '';
    bytesThisSecond = 0;
  }, 1000);

  // --- Touch and scrolling --------------------------------------------------------------------------------------

  /** Where the pointer is on the device's screen, as fractions of its width and height, from 0 to 1. */
  function screenPoint(event) {
    const box = canvas.getBoundingClientRect(),
      border = parseFloat(getComputedStyle(canvas).borderLeftWidth) || 0;
    const x = (event.clientX - box.left - border) / (box.width - 2 * border);
    const y = (event.clientY - box.top - border) / (box.height - 2 * border);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  // Android key codes and meta state flags (android.view.KeyEvent).
  const KEYCODE_HOME = 3,
    KEYCODE_BACK = 4,
    KEYCODE_APP_SWITCH = 187,
    KEYCODE_C = 31,
    KEYCODE_X = 52,
    META_CTRL_ON = 0x1000;
  /** Presses and lets go of one of the device's keys. */
  const pressKey = (code) => {
    device.key(0, code, 0);
    device.key(1, code, 0);
  };
  // Whether the left button is down: a finger on the screen.
  let touching = false;
  canvas.addEventListener('pointerdown', (event) => {
    if (!connected) return;
    event.preventDefault();
    typing.focus({ preventScroll: true });
    if (event.button === 2) {
      pressKey(KEYCODE_BACK);
      return;
    }
    if (event.button === 1) {
      pressKey(KEYCODE_HOME);
      return;
    }
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    touching = true;
    const { x, y } = screenPoint(event);
    device.touch(0, x, y);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!touching) return;
    // Every move the browser saw since the last event, so a quick swipe keeps its shape.
    for (const each of event.getCoalescedEvents?.() || [event]) {
      const { x, y } = screenPoint(each);
      device.touch(2, x, y);
    }
  });
  const liftFinger = (event) => {
    if (!touching) return;
    touching = false;
    const { x, y } = screenPoint(event);
    device.touch(1, x, y);
  };
  canvas.addEventListener('pointerup', liftFinger);
  canvas.addEventListener('pointercancel', liftFinger);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  // The wheel scrolls where the pointer is. Lines and pages are turned into the device's scroll steps, at most 20 at
  // a time either way.
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!connected) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 1 / 3 : event.deltaMode === 2 ? 3 : 1 / 100;
      const limit = (value) => Math.max(-20, Math.min(20, value));
      const { x, y } = screenPoint(event);
      device.scroll(x, y, limit(-event.deltaX * scale), limit(-event.deltaY * scale));
    },
    { passive: false },
  );

  // --- Typing ---------------------------------------------------------------------------------------------------
  // Characters arrive through a hidden text field, so the computer's keyboard layout, its accents, AltGr and input
  // methods work as anywhere else, and the device types the finished text. keys.js (AndroidKeys) picks the keys that go
  // as Android key codes instead: keys that aren't characters, and shortcuts, with ⌘ as Ctrl on a Mac.

  // The keys held down on the device: KeyboardEvent.code -> [Android key code, meta state].
  const held = new Map();
  typing.addEventListener('keydown', (event) => {
    const action = AndroidKeys.keyAction(
      {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        isComposing: event.isComposing,
        altGraph: event.getModifierState('AltGraph'),
      },
      { platform: device.platform, fullscreen: session.classList.contains('fullscreen') },
    );
    // No action: text, which arrives through the field. 'system': a key the computer's own system handles.
    if (!action || action.local === 'system') return;
    event.preventDefault();
    if (action.local) {
      toggleFullscreen();
      return;
    }
    if (!connected) return;
    held.set(event.code, [action.send, action.meta]);
    device.key(0, action.send, action.meta);
    // Ctrl+C or Ctrl+X on the device: look at its clipboard once the app has had time to copy.
    if (action.meta & META_CTRL_ON && (action.send === KEYCODE_C || action.send === KEYCODE_X))
      setTimeout(() => device.checkClipboard(), 400);
  });
  typing.addEventListener('keyup', (event) => {
    const key = held.get(event.code);
    if (!key) return;
    held.delete(event.code);
    event.preventDefault();
    device.key(1, ...key);
  });

  /** Lets go of every key held down on the device, as when the window loses the focus. */
  function releaseKeys() {
    for (const [code, meta] of held.values()) device.key(1, code, meta);
    held.clear();
  }

  /** Sends what was typed in the hidden field to the device, in pieces of up to 500 characters, and empties it. */
  function flush() {
    const characters = Array.from(typing.value);
    typing.value = '';
    if (!connected) return;
    for (let i = 0; i < characters.length; i += 500)
      device.text(characters.slice(i, i + 500).join(''));
  }
  // While an input method composes (an accent, a word in another script), the text waits until it is finished.
  typing.addEventListener('input', (event) => {
    if (!event.isComposing) flush();
  });
  typing.addEventListener('compositionend', () => setTimeout(flush));
  window.addEventListener('blur', releaseKeys);

  // --- Clipboard ------------------------------------------------------------------------------------------------
  // The shared clipboard follows the clipboard card in Settings, which this window can read (ym.clipboard) and hears
  // change. Leaving the window, as to paste somewhere else, looks at the device's clipboard for anything copied there
  // meanwhile.

  /** The clipboard setting: on unless turned off, and both ways unless set to 'to' or 'from'. */
  function clipboardMode() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('ym.clipboard'));
    } catch {
      /* the default */
    }
    return {
      on: saved?.on !== false,
      way: ['to', 'both', 'from'].includes(saved?.way) ? saved.way : 'both',
    };
  }
  device.clipboardMode(clipboardMode());
  window.addEventListener('storage', (event) => {
    if (event.key === 'ym.clipboard') device.clipboardMode(clipboardMode());
  });
  window.addEventListener('blur', () => {
    if (connected) device.checkClipboard();
  });

  // --- The device's buttons -------------------------------------------------------------------------------------

  // Back, Home and Recents. Clicking one leaves the keyboard focus on the device's screen.
  for (const [id, code] of [
    ['back', KEYCODE_BACK],
    ['home', KEYCODE_HOME],
    ['recents', KEYCODE_APP_SWITCH],
  ]) {
    $(id).addEventListener('mousedown', (event) => event.preventDefault());
    $(id).addEventListener('click', () => pressKey(code));
  }

  /**
   * Settings can swap Back and Recents to Samsung's order (ym.recentsFirst); a change there reaches open windows at
   * once.
   */
  function orderButtons() {
    let recentsFirst = false;
    try {
      recentsFirst = JSON.parse(localStorage.getItem('ym.recentsFirst')) === true;
    } catch {
      /* the usual order */
    }
    $('home').before($(recentsFirst ? 'recents' : 'back'));
    $('home').after($(recentsFirst ? 'back' : 'recents'));
  }
  orderButtons();
  window.addEventListener('storage', (event) => {
    if (event.key === 'ym.recentsFirst') orderButtons();
  });
  // Disconnect closes this window, and the main window says so, as for a computer.
  $('disconnect').addEventListener('click', () => device.disconnect());

  // The device's own on-screen keyboard stays hidden while you type from here. Its switch, in the bar and in full
  // screen's bar, lets it show.
  const keyboardSwitches = [$('soft-keyboard'), $('fs-keyboard')];
  for (const button of keyboardSwitches) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const show = button.getAttribute('aria-checked') !== 'true';
      for (const each of keyboardSwitches) each.setAttribute('aria-checked', String(show));
      device.keyboard(show);
    });
  }

  // --- The sound switch -----------------------------------------------------------------------------------------

  /** The sound buttons, in the bar and in full screen's bar, and the volume, as muted says. */
  function renderSound() {
    for (const button of [$('sound'), $('fs-sound')]) {
      button.setAttribute('aria-pressed', String(!muted));
      button.title = muted
        ? 'Play the device’s sound on this computer'
        : 'Mute the device’s sound on this computer';
      button.querySelector('.icon').dataset.icon = muted ? 'speaker-off' : 'speaker-on';
      button.querySelector('.label').textContent = muted ? 'Muted' : 'Sound';
      window.PixelIcons?.render(button);
    }
    if (volume) volume.gain.value = muted ? 0 : 1;
  }
  for (const id of ['sound', 'fs-sound']) {
    $(id).addEventListener('mousedown', (event) => event.preventDefault());
    $(id).addEventListener('click', () => {
      muted = !muted;
      try {
        localStorage.setItem('ym.androidMuted', JSON.stringify(muted));
      } catch {
        /* remembered for this window only */
      }
      renderSound();
    });
  }
  renderSound();

  // --- Screenshots and notices ----------------------------------------------------------------------------------
  // Screenshot: in advanced mode the device takes it, so it is as sharp as its screen; in general mode it is this
  // window's picture of the screen. The computer keeps it in Pictures.

  // The timer that hides the notice, and what its Show button does, if it has one.
  let noticeTimer = 0,
    noticeShow = null;

  /** A short notice at the bottom of the window, for 6 seconds. `show`, when given, adds a Show button that runs it. */
  function notice(text, error = false, show = null) {
    $('notice-text').textContent = text;
    $('notice').classList.toggle('error', error);
    noticeShow = show;
    $('notice-show').hidden = !show;
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      $('notice').hidden = true;
    }, 6000);
  }

  /** Takes a screenshot, with a flash on the screen, and says where it was saved. */
  async function screenshot() {
    if (!connected) return;
    $('stage').classList.remove('flash');
    void $('stage').offsetWidth; // restart the flash
    $('stage').classList.add('flash');
    try {
      const picture =
        transport === 'network'
          ? new Uint8Array(
              await (await new Promise((done) => canvas.toBlob(done, 'image/png'))).arrayBuffer(),
            )
          : undefined;
      const { folder } = await device.screenshot(picture);
      notice(`Screenshot saved in ${folder}.`, false, () => device.showScreenshot());
    } catch (error) {
      // Without the "Error invoking remote method" prefix Electron adds.
      notice(
        `The screenshot didn't work: ${String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`,
        true,
      );
    }
  }
  for (const id of ['screenshot', 'fs-screenshot']) {
    $(id).addEventListener('mousedown', (event) => event.preventDefault());
    $(id).addEventListener('click', screenshot);
  }
  $('notice-show').addEventListener('mousedown', (event) => event.preventDefault());
  $('notice-show').addEventListener('click', () => {
    noticeShow?.();
    $('notice').hidden = true;
  });

  // --- Files ----------------------------------------------------------------------------------------------------
  // Dropped anywhere on the window, or chosen in the Files drawer, files go one after another to the device's
  // Download folder (src/main/android/files.cjs). What the device shares to Yes Machine arrives here, and this
  // computer asks where to save it.

  // Whether the device's side can exchange files.
  let filesReady = false;
  const formatSize = (bytes) =>
    bytes >= 1e9
      ? `${(bytes / 1e9).toFixed(1)} GB`
      : bytes >= 1e6
        ? `${(bytes / 1e6).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  const percent = (file) =>
    file.size ? Math.min(100, Math.floor((file.done / file.size) * 100)) : 100;

  /** Opens or closes the Files drawer beside the screen. */
  function showDrawer(open) {
    $('drawer').hidden = !open;
    for (const button of document.querySelectorAll('.files-toggle'))
      button.setAttribute('aria-pressed', String(open));
    fitScreen();
    if (!open) typing.focus({ preventScroll: true });
  }
  for (const button of document.querySelectorAll('.files-toggle'))
    button.addEventListener('click', () => showDrawer($('drawer').hidden));
  $('drawer-close').addEventListener('click', () => showDrawer(false));

  function renderFilesReady() {
    $('file-input').disabled = !filesReady;
    if (!filesReady && connected)
      $('file-status').textContent =
        `Files can’t reach ${deviceName} now. Update Yes Machine on the device, then connect again.`;
  }

  /** Sends files to the device, or says why they can't go. */
  function sendFiles(files) {
    if (!files.length) return;
    if (!filesReady) {
      notice(
        connected
          ? `Files can’t reach ${deviceName} now. Update Yes Machine on the device, then connect again.`
          : 'Files can go once the device is connected.',
        true,
      );
      return;
    }
    device.sendFiles(files);
  }
  $('file-input').addEventListener('change', () => {
    sendFiles([...$('file-input').files]);
    $('file-input').value = '';
  });
  // Dragging files over any part of the window shows where they go; dropping them sends them. The window counts
  // enters and leaves, because dragging over a child element leaves its parent.
  let dragDepth = 0;
  const dragsFiles = (event) => event.dataTransfer?.types.includes('Files');
  document.addEventListener('dragenter', (event) => {
    if (dragsFiles(event)) {
      dragDepth++;
      $('drop-target').hidden = false;
    }
  });
  document.addEventListener('dragleave', (event) => {
    if (dragsFiles(event) && --dragDepth <= 0) {
      dragDepth = 0;
      $('drop-target').hidden = true;
    }
  });
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dragsFiles(event) ? 'copy' : 'none';
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    $('drop-target').hidden = true;
    sendFiles([...(event.dataTransfer?.files || [])]);
  });

  /** Adds a line for a finished file to the drawer, newest first, keeping the last 8. `show` adds a Show button. */
  function addTransfer(file, detail, show) {
    const line = document.createElement('div');
    line.className = 'download';
    line.innerHTML =
      '<span class="icon" data-icon="file"></span><span><b></b><small></small></span>';
    line.querySelector('b').textContent = file.name;
    line.querySelector('small').textContent = `${formatSize(file.size)} · ${detail}`;
    if (show) {
      const button = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'link-button',
        textContent: 'Show',
      });
      button.addEventListener('click', () => device.showFile(file.id));
      line.append(button);
    }
    $('transfers').prepend(line);
    while ($('transfers').children.length > 8) $('transfers').lastElementChild.remove();
    window.PixelIcons?.render(line);
  }

  /** A transfer's progress, in the drawer, and in a notice while the drawer is closed. */
  function showProgress(text, file) {
    $('file-progress').hidden = false;
    $('file-progress').value = percent(file);
    $('file-status').textContent = text;
    if ($('drawer').hidden) notice(text);
  }

  /** How a transfer ended, in the drawer; also in a notice when the drawer is closed, or for an error or a Show. */
  function showResult(text, error = false, show = null) {
    $('file-progress').hidden = true;
    $('file-status').textContent = text;
    if ($('drawer').hidden || error || show) notice(text, error, show);
  }

  /**
   * A file's progress, from the main process: going to the device ('out': sending, sent, failed) or coming from it
   * (receiving, received while the computer asks where to save it, saved, not-saved, failed).
   */
  function onFileEvent(file) {
    if (file.direction === 'out') {
      if (file.state === 'sending') showProgress(`Sending ${file.name} · ${percent(file)}%`, file);
      else if (file.state === 'sent') {
        // The device saved it under another name when the name was taken.
        const savedAs = file.detail && file.detail !== file.name ? ` as ${file.detail}` : '';
        addTransfer(file, `in the device’s Download folder${savedAs}`);
        showResult(`${file.name} is in the device’s Download folder${savedAs}.`);
      } else if (file.state === 'failed')
        showResult(`${file.name} didn’t go: ${file.detail || 'the device didn’t take it.'}`, true);
      return;
    }
    if (file.state === 'receiving')
      showProgress(`Receiving ${file.name} from ${deviceName} · ${percent(file)}%`, file);
    else if (file.state === 'received') showResult(`Choose where to save ${file.name}.`);
    else if (file.state === 'saved') {
      addTransfer(file, `from the device · saved in ${file.folder}`, true);
      showResult(`Saved ${file.detail} in ${file.folder}.`, false, () => device.showFile(file.id));
    } else if (file.state === 'not-saved') {
      addTransfer(file, 'from the device · not saved');
      showResult(`${file.name} wasn’t saved.`);
    } else if (file.state === 'failed')
      showResult(`${file.name} didn’t arrive: ${file.detail || 'the transfer stopped.'}`, true);
  }

  // --- Hide bars and full screen --------------------------------------------------------------------------------
  // Hide bars, as in the computer viewer: only the device's screen, filling the window, with a small bar at the top
  // that fades after a few seconds; full screen does the same over the whole screen. The small bar's Show bars brings
  // everything back, and its Full screen switches between the two. Leaving full screen goes back to where it started.
  // Escape, F11 or ⌃⌘F on a Mac leave full screen. Where the window can't go full screen, hiding the bars is the
  // closest.

  // Whether the bars are hidden in the window (as opposed to full screen), and the timer that fades the small bar.
  let barsHidden = false,
    quietTimer = null;

  /** Shows the page as full screen or hidden bars say, and the buttons' labels to match. */
  function syncFullscreen() {
    const whole = Boolean(document.fullscreenElement),
      full = whole || barsHidden;
    session.classList.toggle('fullscreen', full);
    session.classList.remove('quiet');
    clearTimeout(quietTimer);
    if (full) quietTimer = setTimeout(() => session.classList.add('quiet'), 3000);
    $('fullscreen').setAttribute('aria-label', whole ? 'Exit full screen' : 'Full screen');
    $('fullscreen-exit').setAttribute('aria-pressed', String(whole));
    $('fullscreen-exit').querySelector('.label').textContent = whole
      ? 'Exit full screen'
      : 'Full screen';
    fitScreen();
  }

  /** Enters or leaves full screen. When the window can't go full screen, it hides the bars instead. */
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else
      await document.documentElement.requestFullscreen().catch(() => {
        barsHidden = true;
        syncFullscreen();
      });
    typing.focus({ preventScroll: true });
  }

  /** Hide bars (false) and Show bars (true). Showing the bars also leaves full screen. */
  function showBars(show) {
    barsHidden = !show;
    if (show && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    syncFullscreen();
    typing.focus({ preventScroll: true });
  }
  for (const id of ['fullscreen', 'fullscreen-exit']) {
    $(id).addEventListener('mousedown', (event) => event.preventDefault());
    $(id).addEventListener('click', toggleFullscreen);
  }
  for (const [id, show] of [
    ['bars', false],
    ['bars-show', true],
  ]) {
    $(id).addEventListener('mousedown', (event) => event.preventDefault());
    $(id).addEventListener('click', () => showBars(show));
  }
  document.addEventListener('fullscreenchange', () => {
    syncFullscreen();
    releaseKeys();
  });
  window.PixelIcons?.render();
})();
