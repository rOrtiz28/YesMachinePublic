'use strict';
// Sharing this computer's screen.
//
// start() captures the shared screen, with this computer's sound unless the sound is off, and asks the main process
// to listen for viewers on the chosen network (src/main/sharing/server.cjs). A viewer that signs in then connects to
// this window over WebRTC (viewer-connection.js). The main process decides which screen getDisplayMedia() captures.
//
// Sharing follows changes while it runs: another screen chosen here or in the viewer's Screen menu, a screen that is
// unplugged or changes resolution, and networks that come and go.
//
// On macOS and Windows the capture carries the system's sound. Linux's doesn't, so there the main process records
// the system's output with parec and sends it here as raw samples (api.onAudio), which an audio worklet
// (src/windows/shared/pcm-worklet.js) plays into a sound track added to the capture.

// The shared screen (and sound), while sharing. A number that changes whenever sharing stops, so a start that is
// still under way when sharing stops knows it is no longer wanted.
let media = null,
  shareGeneration = 0;
// Whether the sound is shared (ym.audio) and whether sharing starts on its own when the window opens (ym.autoShare).
// Both are on unless turned off.
let audioWanted = read('ym.audio', true) !== false,
  autoShareWanted = read('ym.autoShare', true) !== false;
// The sound's level meter, and on Linux the worklet that plays the recorded sound into the capture.
let audioContext = null,
  audioTimer = null,
  audioNode = null;
// 60 fps, and the screen's own size up to 1920×1200: scaling blurs text, and larger frames cost more to encode and to
// decode than a tablet's hardware decoder handles comfortably.
const VIDEO = { frameRate: { ideal: 60, max: 60 }, width: { max: 1920 }, height: { max: 1200 } };
// The computer's screens (src/main/sharing/screens.cjs) and the id of the shared one. With two or more, the sharing
// card offers the choice and the viewer gets a Screen menu; either one switches the picture without ending the
// session. Also: the switch under way, the screen chosen last, and when the system last ended the capture.
let screens = [],
  currentScreen = null,
  switching = null,
  wantedScreen = null,
  endedAt = 0;
// The networks last listed (as JSON, to notice a change), the address sharing listens on, whether sharing should
// start again once a network is back, and whether a check of the networks is under way.
let shownNetworks = '',
  sharingAddress = '',
  resumeSharing = false,
  followingNetworks = false;

// --- Starting and stopping ------------------------------------------------------------------------------------

/**
 * Starts sharing: captures the screen (and the sound), then listens for viewers on the network chosen on the This
 * computer card, and shows the address and certificate fingerprint to connect with. When capture fails on macOS
 * because Screen Recording isn't allowed, it says where to allow it.
 */
async function start() {
  $('start').disabled = true;
  notice('Preparing the screen…');
  const generation = ++shareGeneration;
  try {
    info = await api.info();
    renderPermissions(info.permissions);
    await api.start();
    media = await navigator.mediaDevices.getDisplayMedia({
      video: VIDEO,
      audio: audioWanted && info.platform !== 'linux',
    });
    // Sharing was stopped while the screen was being captured.
    if (generation !== shareGeneration) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    watchEnded(media.getVideoTracks()[0]);
    if (audioWanted && info.platform === 'linux') {
      // The recorded sound plays through the worklet into a stream destination, whose track joins the capture.
      audioContext = new AudioContext({ sampleRate: 48000 });
      await audioContext.audioWorklet.addModule('../shared/pcm-worklet.js');
      audioNode = new AudioWorkletNode(audioContext, 'pcm-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const destination = audioContext.createMediaStreamDestination();
      audioNode.connect(destination);
      await audioContext.resume();
      destination.stream.getAudioTracks().forEach((track) => media.addTrack(track));
      await api.linuxAudio();
    }
    const result = await api.listen($('network').value);
    $('preview').srcObject = media;
    $('preview-placeholder').hidden = true;
    $('address').textContent = result.url;
    $('fingerprint').textContent = result.fingerprint;
    $('pairing').hidden = false;
    $('start').hidden = true;
    renderShareControls();
    $('audio-toggle').disabled = true;
    $('setting-audio').disabled = true;
    $('status').textContent = 'Sharing is on';
    $('status').classList.add('live');
    if (audioWanted) await monitorAudio(media);
    else $('audio-status').textContent = 'Audio off';
    syncMood();
    sharingAddress = $('network').value;
    write('ym.network', sharingAddress);
    notice(`Sharing. Other computers can sign in as ${info.account || 'this computer’s account'}.`);
  } catch (error) {
    const current = await api.info();
    await stop();
    notice(
      current.platform === 'darwin' && current.permissions.screen !== 'granted'
        ? 'Allow Yes Machine in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen this app.'
        : error.message || 'Unable to start screen sharing.',
      true,
    );
  }
}

/** Stops sharing: ends the viewer's connection, the capture and the sound, and the main process's server. */
async function stop() {
  shareGeneration++;
  closePeer();
  if (media) {
    media.getTracks().forEach((track) => track.stop());
    media = null;
  }
  clearInterval(audioTimer);
  audioTimer = null;
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
    audioNode = null;
  }
  await api.stop();
  $('preview').srcObject = null;
  $('preview-placeholder').hidden = false;
  $('start').hidden = false;
  $('start').disabled = !info?.addresses.length;
  renderShareControls();
  $('pairing').hidden = true;
  $('status').textContent = 'Not sharing';
  $('status').classList.remove('live');
  $('network').disabled = false;
  $('audio-toggle').disabled = false;
  $('setting-audio').disabled = false;
  renderAudio();
  syncMood();
}

/**
 * With automatic sharing on, the sharing card only says it is sharing, and the switch is in Settings. Otherwise
 * the card shows a Stop sharing button.
 */
function renderShareControls() {
  $('stop').hidden = !media || autoShareWanted;
  $('auto-note').hidden = !media || !autoShareWanted;
}

// --- Sound ----------------------------------------------------------------------------------------------------

/** The sound switches on the sharing card and in Settings, and the sound's status while not sharing. */
function renderAudio() {
  $('audio-toggle').setAttribute('aria-pressed', String(audioWanted));
  $('setting-audio').setAttribute('aria-checked', String(audioWanted));
  $('audio-icon').dataset.icon = audioWanted ? 'speaker-on' : 'speaker-off';
  PixelIcons.render($('audio-toggle'));
  if (!media) $('audio-status').textContent = audioWanted ? 'Audio on' : 'Audio off';
}

/** Turns the shared sound on or off. It can't change while sharing; the switches are disabled then. */
function toggleAudio() {
  if (media) return;
  audioWanted = !audioWanted;
  write('ym.audio', audioWanted);
  renderAudio();
}

/** Shows whether the shared sound carries a signal, measured every 0.7 seconds. */
async function monitorAudio(stream) {
  const track = stream.getAudioTracks().find((candidate) => candidate.readyState === 'live');
  if (!track) {
    $('audio-status').textContent = 'Audio unavailable';
    return;
  }
  audioContext ||= new AudioContext({ sampleRate: 48000 });
  await audioContext.resume();
  const source = audioContext.createMediaStreamSource(new MediaStream([track]));
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const values = new Float32Array(analyser.fftSize);
  audioTimer = setInterval(() => {
    if (track.readyState !== 'live') {
      $('audio-status').textContent = 'Audio ended';
      return;
    }
    analyser.getFloatTimeDomainData(values);
    // The signal's root mean square level.
    const level = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    $('audio-status').textContent =
      level > 0.0001 ? 'Audio signal detected' : 'Audio ready · silent';
  }, 700);
}

// --- Screens --------------------------------------------------------------------------------------------------

/** The screen choice on the sharing card, shown only when the computer has two or more screens. */
function renderScreenChoice() {
  $('screen-field').hidden = screens.length < 2;
  $('screen-choice').replaceChildren(
    ...screens.map((item, index) =>
      Object.assign(document.createElement('option'), {
        value: item.id,
        textContent: `${index + 1} · ${item.name}${item.main ? ' (main)' : ''}`,
      }),
    ),
  );
  if (currentScreen) $('screen-choice').value = currentScreen;
}

/** Tells the viewer the screens and the shared one, for its Screen menu. */
function sendScreens() {
  if (channel?.readyState === 'open')
    channel.send(JSON.stringify({ type: 'screens', screens, current: currentScreen }));
}

/** Reads the screens again from the main process, when a screen was added, removed or changed. */
async function refreshScreens() {
  ({ screens, current: currentScreen } = await api.screens());
  renderScreenChoice();
  sendScreens();
}

/**
 * Shares another screen, chosen here or in the viewer. A screen chosen while another switch is under way waits for
 * it, so the last choice is the one that stays. Returns the switch under way.
 */
function switchScreen(id) {
  wantedScreen = id;
  switching ??= (async () => {
    try {
      while (wantedScreen && wantedScreen !== currentScreen) {
        ({ screens, current: currentScreen } = await api.chooseScreen(wantedScreen));
        if (media) await recapture();
      }
    } catch (error) {
      notice(error.message, true);
      if (channel?.readyState === 'open')
        channel.send(JSON.stringify({ type: 'error', message: error.message }));
    } finally {
      switching = null;
      wantedScreen = null;
      renderScreenChoice();
      sendScreens();
    }
  })();
  return switching;
}

/**
 * Captures the shared screen again and hands the new picture to the viewer's connection, without ending the
 * session: the connection's video sender swaps tracks.
 */
async function recapture() {
  const fresh = (
    await navigator.mediaDevices.getDisplayMedia({ video: VIDEO, audio: false })
  ).getVideoTracks()[0];
  if (!media) {
    fresh.stop();
    return;
  }
  const old = media.getVideoTracks()[0],
    sender = old && peer?.getSenders().find((item) => item.track === old);
  if (sender) await sender.replaceTrack(fresh);
  if (old) {
    media.removeTrack(old);
    old.stop();
  }
  media.addTrack(fresh);
  watchEnded(fresh);
  $('preview').srcObject = media;
}

/**
 * When the system ends the capture (a screen unplugged, a new resolution), sharing picks the screen up again once,
 * the main one if the shared one is gone. If the capture ends again within ten seconds, sharing stops.
 */
function watchEnded(track) {
  track.addEventListener(
    'ended',
    async () => {
      if (!media || track !== media.getVideoTracks()[0]) return;
      const again = Date.now() - endedAt > 10000;
      endedAt = Date.now();
      if (again) {
        try {
          await refreshScreens();
          await recapture();
          notice('The screen changed, and sharing picked it up again.');
          return;
        } catch {}
      }
      stop();
      notice('Screen sharing was stopped by the system.');
    },
    { once: true },
  );
}

// --- Networks -------------------------------------------------------------------------------------------------
// Networks come and go: a cable plugged in, Wi-Fi turned off. The list on the This computer card follows them. When
// the network sharing is on disappears, sharing moves to another one, or waits until one comes back.

/** The list of this computer's private networks on its card. The one chosen last (ym.network) stays chosen. */
function renderNetworks() {
  const select = $('network'),
    wanted = select.value || read('ym.network', '');
  select.replaceChildren(
    ...info.addresses.map((network) => {
      const option = document.createElement('option');
      option.value = network.address;
      option.textContent = `${network.address} · ${network.label || network.name}`;
      return option;
    }),
  );
  if (info.addresses.some((network) => network.address === wanted)) select.value = wanted;
  shownNetworks = JSON.stringify(info.addresses);
}

/** The pill in the title bar: "Local" while this computer is on a private network, with its addresses as a tooltip. */
function renderNetworkPill() {
  const live = !!info?.addresses.length,
    pill = $('network-pill');
  pill.textContent = live ? 'Local' : 'No network';
  pill.className = `pill ${live ? 'live' : 'warn'}`;
  pill.title = live
    ? info.addresses.map((network) => network.address).join(', ')
    : 'Join a private network to share this computer.';
}

/**
 * Checks the networks (start.js runs it every 5 seconds). When they changed: with no network left, sharing stops
 * and starts again once one is back; when the network sharing was on is gone, sharing restarts on another one.
 */
async function followNetworks() {
  if (followingNetworks || !info) return;
  followingNetworks = true;
  try {
    const current = await api.info();
    if (JSON.stringify(current.addresses) === shownNetworks) return;
    info = current;
    renderNetworks();
    renderNetworkPill();
    if (!info.addresses.length) {
      if (media) {
        resumeSharing = true;
        await stop();
        notice('This computer left the network. Sharing starts again when it’s back.', true);
      } else $('start').disabled = true;
      return;
    }
    if (media && !info.addresses.some((network) => network.address === sharingAddress)) {
      await stop();
      await start();
      const network = info.addresses.find((candidate) => candidate.address === sharingAddress);
      if (media && network)
        notice(`The network changed. Sharing moved to ${network.label} (${network.address}).`);
    } else if (!media && $('start').hidden === false) {
      $('start').disabled = false;
      if (resumeSharing) {
        resumeSharing = false;
        await start();
      }
    }
  } catch {
  } finally {
    followingNetworks = false;
  }
}

/** Connects the sharing card's buttons, the sound switches and the network choice. Called once by start.js. */
function setUpSharing() {
  $('start').onclick = start;
  $('stop').onclick = () => stop().then(() => notice('Sharing stopped.'));
  $('copy-address').onclick = () =>
    api.copy($('address').textContent).then(() => notice('Address copied.'));
  $('audio-toggle').onclick = toggleAudio;
  $('setting-audio').onclick = toggleAudio;
  $('screen-choice').addEventListener('change', (event) => switchScreen(event.target.value));
  // Picking another network while sharing moves sharing to it.
  $('network').onchange = () => {
    if (media) stop().then(start);
  };
  // On Linux, the recorded system sound, for the worklet to play into the capture.
  api.onAudio((bytes) => {
    if (audioNode) audioNode.port.postMessage(bytes);
  });
  // Closing the window lets go of any key or button the viewer holds down, and ends the capture and the connection.
  window.addEventListener('beforeunload', () => {
    api.release();
    media?.getTracks().forEach((track) => track.stop());
    peer?.close();
  });
}
