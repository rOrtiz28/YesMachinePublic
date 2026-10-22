'use strict';
// The WebRTC connection to the computer: its screen as video, its sound, and the two data channels the computer
// opens:
//  - 'control', ordered and reliable: input, the clipboard, the computer's status, its screens, the cursor's shape
//    and errors;
//  - 'pointer', unordered and never resent: pointer moves, where the next move replaces a lost one (pointer.js).
// There are no STUN or TURN servers: both devices are on the same local network.

// The WebRTC connection, its control and pointer channels, and the stream of the computer's screen and sound.
let peer = null;
let control = null;
let moveChannel = null;
let remoteStream = null;
// Whether the computer accepts input: true, false when it can only be watched, and null until it says.
let activeInput = null;
// Whether the computer is sending sound.
let hasAudio = false;

/**
 * Starts the WebRTC connection for the session of generation `thisGeneration`, once the computer has paired. The
 * computer makes the offer; tracks and data channels arrive here. If the connection drops for 12 seconds, or fails,
 * the session ends.
 */
function startPeer(thisGeneration) {
  stopViewReports();
  peer = new RTCPeerConnection({ iceServers: [] });
  const currentPeer = peer;
  remoteStream = new MediaStream();
  video.srcObject = remoteStream;
  currentPeer.onicecandidate = (event) => {
    if (thisGeneration !== generation) return;
    try {
      wsSend({ type: 'ice', candidate: event.candidate?.toJSON() ?? null });
    } catch (error) {
      fail(error.message);
    }
  };
  currentPeer.ontrack = (event) => {
    if (thisGeneration !== generation) return;
    if (!remoteStream.getTrackById(event.track.id)) remoteStream.addTrack(event.track);
    if (event.track.kind === 'audio') {
      hasAudio = true;
      updateAudio();
    }
    event.track.onended = () => {
      if (thisGeneration !== generation) return;
      if (event.track.kind === 'audio') {
        hasAudio = remoteStream.getAudioTracks().some((track) => track.readyState === 'live');
        updateAudio();
      } else {
        $('video-placeholder').hidden = false;
        $('video-status').textContent = 'Screen sharing stopped';
        $('video-hint').textContent = 'Start screen sharing again on the host, then reconnect.';
        releaseInput();
        sessionStatus('The host stopped sharing its screen.', 'offline');
      }
    };
    video.play().catch(() => {
      if (thisGeneration !== generation) return;
      video.muted = true;
      updateAudio();
      video.play().catch(() => showNotice('Tap the remote desktop to start playback.'));
    });
  };
  currentPeer.ondatachannel = (event) => {
    if (thisGeneration === generation && event.channel.label === 'pointer') {
      moveChannel?.close();
      moveChannel = event.channel;
      return;
    }
    if (thisGeneration !== generation || event.channel.label !== 'control') {
      event.channel.close();
      return;
    }
    control?.close();
    control = event.channel;
    control.onopen = () => {
      if (thisGeneration !== generation) return;
      sendControl({ type: 'release' });
      if (matchMedia('(pointer: fine)').matches) sendControl({ type: 'local-cursor', on: true });
      updateInputStatus();
    };
    control.onclose = () => {
      if (thisGeneration !== generation) return;
      releaseInput();
      updateInputStatus();
      sessionStatus('Control connection closed. Reconnect to control the host.', 'offline');
      showNotice(
        'The desktop control connection closed. Disconnect and connect again.',
        true,
        true,
      );
    };
    control.onerror = () => {
      if (thisGeneration === generation)
        showNotice('The control connection encountered an error.', true);
    };
    control.onmessage = (event) => {
      if (
        thisGeneration !== generation ||
        typeof event.data !== 'string' ||
        event.data.length > MAX_TEXT + 4096
      )
        return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (
        message.type === 'clipboard' &&
        typeof message.text === 'string' &&
        message.text.length <= MAX_TEXT
      ) {
        $('clipboard-text').value = message.text;
        lastClipboard = message.text;
        showNotice('Host clipboard received. Choose “Copy text” to copy it to this device.');
      } else if (
        message.type === 'clipboard-auto' &&
        typeof message.text === 'string' &&
        message.text.length <= MAX_TEXT
      ) {
        if (clipboardFrom()) {
          lastClipboard = message.text;
          writeClipboard(message.text);
        }
      } else if (message.type === 'status') {
        if (typeof message.input === 'boolean') activeInput = message.input;
        if (typeof message.clipboard === 'string') {
          clipboardMode = message.clipboard;
          renderClipboardMode();
        }
        if (message.audio === false && !remoteStream.getAudioTracks().length) hasAudio = false;
        if (message.view === true) startViewReports();
        updateInputStatus();
        updateAudio();
      } else if (message.type === 'error') {
        showNotice(
          typeof message.message === 'string'
            ? message.message
            : 'The host could not complete that action.',
          true,
        );
      } else if (message.type === 'screens' && Array.isArray(message.screens)) {
        screens = message.screens.filter(validScreen).slice(0, 16);
        currentScreen = typeof message.current === 'string' ? message.current : null;
        clearTimeout(screenTimer);
        $('screens-switching').hidden = true;
        renderScreens();
      } else if (message.type === 'local-cursor') {
        localCursor = message.on === true;
        if (!localCursor) video.style.cursor = '';
      } else if (message.type === 'cursor' && localCursor) {
        video.style.cursor = CURSORS.has(message.shape) ? message.shape : 'default';
      }
    };
    updateInputStatus();
  };
  currentPeer.onconnectionstatechange = () => {
    if (thisGeneration !== generation) return;
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
    if (currentPeer.connectionState === 'connected') {
      clearTimeout(connectTimer);
      sessionStatus('Connected directly over your local network', 'connected');
    } else if (currentPeer.connectionState === 'disconnected') {
      releaseInput();
      sessionStatus('Connection interrupted. Trying to reconnect…', 'pending');
      $('video-placeholder').hidden = false;
      $('video-status').textContent = 'Connection interrupted';
      $('video-hint').textContent = 'Checking the connection to your computer…';
      disconnectTimer = setTimeout(() => {
        if (thisGeneration === generation)
          fail(
            'The desktop connection was lost. Check that both devices are still on the same network, then reconnect.',
          );
      }, 12000);
    } else if (currentPeer.connectionState === 'failed') {
      fail(
        'Could not connect to the remote desktop. Check the host’s permissions and firewall, then try again.',
      );
    }
    if (currentPeer.connectionState === 'connected' && video.readyState >= 2)
      $('video-placeholder').hidden = true;
  };
}

// --- Messages to the computer ---------------------------------------------------------------------------------

/**
 * Sends a message on the control channel. Returns false when the channel isn't open, when more than 1 MB is already
 * waiting to go (except for 'release', which always goes), or when the message is over 60,000 bytes.
 */
function sendControl(message) {
  if (!control || control.readyState !== 'open') return false;
  if (control.bufferedAmount > 1024 * 1024 && message.type !== 'release') return false;
  try {
    const encoded = JSON.stringify(message);
    if (new TextEncoder().encode(encoded).length > 60000) return false;
    control.send(encoded);
    return true;
  } catch {
    return false;
  }
}

/** Sends a message the user asked for, and says so when the control connection isn't ready. */
function controlAction(message) {
  if (!sendControl(message)) showNotice('The control connection is not ready.', true);
}

// --- The status strip -----------------------------------------------------------------------------------------

/** Whether input reaches the computer: pending, view only, or available. */
function updateInputStatus() {
  const ready = control?.readyState === 'open';
  $('input-status').textContent = !ready
    ? 'Input pending'
    : activeInput === false
      ? 'View only'
      : activeInput === true
        ? 'Input available'
        : 'Control connected';
  $('input-status').dataset.state = !ready ? 'pending' : activeInput === false ? 'view' : 'ready';
}

/** The sound button and the sound's status. Browsers start the video muted; the button turns the sound on. */
function updateAudio() {
  const on = hasAudio && !video.muted;
  $('audio-button').disabled = !hasAudio;
  $('audio-button').setAttribute(
    'aria-label',
    !hasAudio ? 'No audio stream' : on ? 'Turn off audio' : 'Turn on audio',
  );
  $('audio-button').setAttribute('aria-pressed', String(on));
  setIcon($('audio-button'), on ? 'speaker-on' : 'speaker-off');
  $('audio-status').textContent = !hasAudio ? 'No audio' : on ? 'Audio on' : 'Audio off';
}

/** Connects the sound button, and hides the video's placeholder once the picture plays. Called once by start.js. */
function setUpStream() {
  video.addEventListener('playing', () => {
    if (paired && peer?.connectionState !== 'disconnected') $('video-placeholder').hidden = true;
  });
  $('audio-button').addEventListener('click', async () => {
    video.muted = !video.muted;
    try {
      await video.play();
    } catch {
      video.muted = true;
      showNotice('Audio playback was blocked. Tap “Enable audio” to try again.', true);
    }
    updateAudio();
  });
}
