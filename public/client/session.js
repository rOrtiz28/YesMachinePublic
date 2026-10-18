'use strict';
// The session with the computer.
//
// After signing in (sign-in.js), or with the one-time ticket the desktop and Android apps put in the page's address,
// the page opens a WebSocket to the computer's /session and authorizes it with the ticket. The computer answers
// 'paired' with its name and system, then the two sides exchange the WebRTC offer, answer and network candidates
// over the socket (handleSignal); the WebRTC connection itself is in stream.js. Files travel over the same socket
// (files.js).
//
// Each session has a generation number. Whatever arrives late from an earlier session, after a disconnect or a new
// sign-in, sees that the generation changed and is ignored.

// The session socket; what cancels a file transfer when the session ends; the session's generation number;
// whether the computer has paired (signed in); the timers that give up on connecting (45 s) and on a dropped
// connection (12 s); and network candidates that arrive before the offer, which wait for it.
let socket = null;
let aborter = null;
let generation = 0;
let paired = false;
let connectTimer = null;
let disconnectTimer = null;
let pendingIce = [];
// The computer's name, and its system: 'darwin', 'win32' or 'linux'.
let hostName = '';
let hostPlatform = '';
// The desktop and Android apps sign in themselves and open this page with the one-time ticket in the address's
// fragment (#ticket=...). start.js takes it out of the address.
const appTicket = /^#ticket=([0-9a-f]{64})$/.exec(location.hash)?.[1] || null;

// --- The session socket ---------------------------------------------------------------------------------------

/** Sends a message on the session socket. Throws when the socket has closed. */
function wsSend(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN)
    throw new Error('The connection has closed. Connect again to continue.');
  socket.send(JSON.stringify(message));
}

/** Whether this browser can connect: the page must have come over HTTPS, and the browser must have WebRTC. */
function canConnect() {
  if (!window.isSecureContext || location.protocol !== 'https:') {
    showNotice('Open the HTTPS address shown by Yes Machine on the host computer.', true, true);
    return false;
  }
  if (!window.RTCPeerConnection) {
    showNotice(
      'This browser does not support remote desktop streaming. Try a current Chrome, Firefox, Edge, or Safari browser.',
      true,
      true,
    );
    return false;
  }
  return true;
}

/**
 * Opens the session socket and authorizes it with a one-time sign-in ticket (`credential` is { type: 'ticket',
 * ticket }). Messages are handled one after another, in order. Without a desktop after 45 seconds, it gives up.
 */
function openSession(credential) {
  cleanup();
  aborter = new AbortController();
  const thisGeneration = generation;
  $('connect-button').disabled = true;
  $('connect-label').textContent = 'Connecting…';
  welcomeCat.setMood('happy');
  $('notice').hidden = true;
  const url = new URL('/session', location.href);
  url.protocol = 'wss:';
  socket = new WebSocket(url);
  let signalQueue = Promise.resolve();
  socket.onopen = () => {
    if (thisGeneration !== generation) return;
    wsSend(credential);
  };
  socket.onmessage = (event) => {
    if (thisGeneration !== generation || typeof event.data !== 'string') return;
    // Another device signed in and took over. Handled right away, before the socket's close event.
    if (event.data.length < 64 && /^\{"type":"replaced"\}$/.test(event.data)) {
      disconnect(
        `Another device connected to ${hostName || 'this computer'}, so this session ended.`,
        true,
        'replaced',
      );
      return;
    }
    signalQueue = signalQueue
      .then(async () => {
        if (thisGeneration !== generation) return;
        if (event.data.length > MAX_TEXT + 4096)
          throw new Error('The host sent a message that exceeds the size limit.');
        const message = JSON.parse(event.data);
        await handleSignal(message, thisGeneration);
      })
      .catch((error) => {
        if (thisGeneration === generation)
          fail(error.message || 'The remote connection could not be established.');
      });
  };
  socket.onerror = () => {
    if (thisGeneration === generation)
      fail(
        'Could not reach the host. Check its HTTPS address, certificate, and local network connection.',
      );
  };
  socket.onclose = () => {
    if (thisGeneration === generation)
      fail('The host connection closed. Keep Yes Machine open on the host, then reconnect.');
  };
  connectTimer = setTimeout(() => {
    if (thisGeneration === generation)
      fail(
        'The connection timed out. Check the host’s permissions and the network, then try again.',
      );
  }, 45000);
}

/**
 * Handles one message from the computer on the session socket: 'paired' (signed in: the session screen shows and
 * the WebRTC connection starts), 'error', the WebRTC offer and network candidates, a file's progress, and files the
 * computer offers.
 */
async function handleSignal(message, thisGeneration) {
  if (!message || typeof message !== 'object' || thisGeneration !== generation) return;
  if (message.type === 'paired') {
    if (paired) return;
    paired = true;
    // What was copied here before connecting stays here: only what's copied from now on goes across.
    if (clipboardReadable === 'granted' && !window.__yesMachineNativeClipboard)
      readClipboard().then((text) => {
        if (lastClipboard === null) lastClipboard = text;
      });
    hostPlatform = message.platform;
    keyboard.setHost(hostPlatform);
    hostName =
      typeof message.hostName === 'string' ? message.hostName.slice(0, 160) : 'Remote computer';
    $('host-name').textContent = hostName;
    document.title = `${hostName} · Yes Machine`;
    document.querySelectorAll('.host-label').forEach((label) => {
      label.textContent = hostName;
    });
    renderClipboardMode();
    $('meta-key').textContent =
      hostPlatform === 'darwin' ? 'Cmd' : hostPlatform === 'win32' ? 'Win' : 'Super';
    $('video-status').textContent = `Connecting to ${hostName}`;
    $('video-hint').textContent = 'Starting the desktop stream…';
    showScreen('session');
    $('notice').hidden = true;
    sessionStatus('Signed in. Connecting to the desktop…');
    startPeer(thisGeneration);
    return;
  }
  if (message.type === 'error') {
    const explanation =
      typeof message.message === 'string' ? message.message : 'The host reported an error.';
    rejectFileReady(explanation);
    rejectFileDone(explanation);
    if (uploadActive) uploadError = explanation;
    if (!paired) fail(explanation);
    else showNotice(explanation, true, true);
    return;
  }
  if (!paired) return;
  if (message.type === 'offer') {
    if (!message.sdp || message.sdp.type !== 'offer' || typeof message.sdp.sdp !== 'string')
      throw new Error('The host sent an invalid desktop offer.');
    const currentPeer = peer;
    await currentPeer.setRemoteDescription(message.sdp);
    if (thisGeneration !== generation) return;
    for (const candidate of pendingIce) await currentPeer.addIceCandidate(candidate);
    pendingIce = [];
    const answer = await currentPeer.createAnswer();
    if (thisGeneration !== generation) return;
    await currentPeer.setLocalDescription(answer);
    if (thisGeneration !== generation) return;
    wsSend({ type: 'answer', sdp: currentPeer.localDescription.toJSON() });
  } else if (message.type === 'ice') {
    if (message.candidate !== null && (typeof message.candidate !== 'object' || !message.candidate))
      return;
    if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
    else if (pendingIce.length < 256) pendingIce.push(message.candidate);
  } else if (message.type === 'file-ready') {
    if (fileReady && typeof message.id === 'string' && message.id.length <= 128) {
      const current = fileReady;
      fileReady = null;
      clearTimeout(current.timer);
      current.resolve(message.id);
    }
  } else if (message.type === 'file-done') {
    if (!fileDone) return;
    const current = fileDone;
    fileDone = null;
    clearTimeout(current.timer);
    current.resolve();
    $('file-status').textContent = `Sent ${safeFilename(message.name)} to ${hostName}.`;
    $('file-progress').value = 100;
    showNotice('Your file arrived on the host computer.');
  } else if (typeof message.type === 'string' && message.type.startsWith('download-')) {
    receiveDownload(message);
  }
}

// --- Ending a session -----------------------------------------------------------------------------------------

/**
 * Ends everything the session started and puts the page back as it was before signing in: the socket, the WebRTC
 * connection, input held down, transfers, the clipboard's state and the screens. The next session gets a new
 * generation number.
 */
function cleanup() {
  releaseInput();
  clipboardMode = null;
  lastClipboard = null;
  pendingClipboard = null;
  renderClipboardMode();
  localCursor = false;
  video.style.cursor = '';
  screens = [];
  currentScreen = null;
  clearTimeout(screenTimer);
  $('screens-switching').hidden = true;
  renderScreens();
  generation += 1;
  clearTimeout(connectTimer);
  clearTimeout(disconnectTimer);
  connectTimer = null;
  disconnectTimer = null;
  aborter?.abort();
  aborter = null;
  rejectFileReady('The connection closed before the file could be sent.');
  rejectFileDone('The connection closed before the host confirmed the file.');
  uploadError = null;
  paired = false;
  pendingIce = [];
  download = null;
  uploadActive = false;
  activeInput = null;
  hasAudio = false;
  if (control) {
    control.onopen = control.onclose = control.onerror = control.onmessage = null;
    control.close();
    control = null;
  }
  moveChannel?.close();
  moveChannel = null;
  clearTimeout(settleTimer);
  settleTimer = null;
  if (peer) {
    peer.ontrack = peer.onicecandidate = peer.ondatachannel = peer.onconnectionstatechange = null;
    peer.close();
    peer = null;
  }
  if (socket) {
    socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
    socket.close();
    socket = null;
  }
  remoteStream?.getTracks().forEach((track) => track.stop());
  remoteStream = null;
  video.pause();
  video.srcObject = null;
  video.muted = true;
  $('file-input').disabled = false;
  $('file-input').value = '';
  $('file-progress').hidden = true;
  $('connect-button').disabled = false;
  $('connect-label').textContent = 'Connect';
  $('sign-in-password').value = '';
  revealPassword(false);
  $('clipboard-text').value = '';
  $('remote-text').value = '';
  showPanel(null, false);
  $('video-placeholder').hidden = false;
  $('video-status').textContent = 'Connecting';
  $('video-hint').textContent = 'Keep Yes Machine open on the other computer.';
  $('file-status').textContent = 'Ready when you are.';
  sessionStatus('Waiting for the remote desktop…');
  updateAudio();
  updateInputStatus();
}

/**
 * Ends the session. In the desktop or Android app the page puts the reason in its address (#ended-closed, -lost or
 * -replaced), and the app closes its window and says why on its own main screen. In a browser the welcome screen
 * comes back with the message.
 */
function disconnect(
  message = 'Disconnected. You can connect again whenever you like.',
  error = false,
  reason = error ? 'lost' : 'closed',
) {
  cleanup();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (appTicket) {
    // the app closes this window and tells the user, back on its main screen
    location.hash = `ended-${reason}`;
    // An app from before takeovers doesn't know this reason and would leave the window open; it knows a lost one.
    if (reason === 'replaced')
      setTimeout(() => {
        location.hash = 'ended-lost';
      }, 500);
    return;
  }
  showScreen('welcome');
  showNotice(message, error, error);
  $($('sign-in-user').value ? 'sign-in-password' : 'sign-in-user').focus();
}

/** Ends the session because something went wrong, with the message as a sticky error. */
function fail(message) {
  disconnect(message, true);
}

/** Connects the Disconnect button, and ends the session when the page goes away. Called once by start.js. */
function setUpSession() {
  window.addEventListener('pagehide', () => {
    cleanup();
  });
  $('disconnect-button').addEventListener('click', () => disconnect());
}
