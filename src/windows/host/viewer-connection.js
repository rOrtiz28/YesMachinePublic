'use strict';
// The connection to the viewer: the device that is looking at this computer while it shares.
//
// When a viewer signs in, the main process tells this window ('viewer-joined', see start.js) and newViewer() opens a
// WebRTC connection to it, carrying the shared screen and sound and two data channels:
//  - 'control', ordered and reliable: clicks, keys, scrolling, the clipboard, screen choices, and status;
//  - 'pointer', unordered and never resent: pointer moves, where the next move replaces a lost one.
// Input from the viewer goes to the main process (api.input), which moves the pointer and types on this computer
// (src/main/control/input.cjs). The offer, the answer and the network candidates travel through the main process and
// the viewer's connection to its server (api.signal here, api.onSignal back).
//
// There is one viewer at a time: a new one replaces the one before.

// The connection, its control channel, and the viewer it belongs to (an id from the main process). Network candidates
// from the viewer that arrive before its answer wait in `ice`.
let peer = null,
  channel = null,
  viewerId = null,
  ice = [];
// Flood protection: input events waiting for the main process, and how many messages arrived in the current second.
let pending = 0,
  messageWindow = 0,
  messageCount = 0;
// Whether the viewer's connection is up.
let connected = false;

/**
 * Opens the connection to a viewer that just signed in. `id` identifies it with the main process; `address` is shown
 * on the sharing card.
 */
async function newViewer(id, address) {
  closePeer();
  viewerId = id;
  const connection = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
  peer = connection;
  media.getTracks().forEach((track) => connection.addTrack(track, media));
  // Up to 10 Mbps on the local network. With a lot of motion, such as a video, the default 2.5 Mbps cap left the
  // picture blurry, and the motion measured sharp at about 6.5 Mbps. A higher cap made very bad Wi-Fi worse, because
  // the sender kept probing above what the link could carry.
  const video = connection.getSenders().find((sender) => sender.track?.kind === 'video');
  const parameters = video?.getParameters();
  if (parameters?.encodings?.length) {
    parameters.encodings[0].maxBitrate = 10_000_000;
    video.setParameters(parameters).catch(() => {});
  }
  channel = connection.createDataChannel('control', { ordered: true });
  const control = channel;
  // Pointer moves get their own channel that never waits for a lost packet: the next move replaces it. Clicks, keys
  // and everything else stay on the ordered, reliable control channel. Each pointer message carries a sequence number,
  // so a late move never undoes a newer move or a click.
  const moves = connection.createDataChannel('pointer', { ordered: false, maxRetransmits: 0 });
  let lastPointer = 0;
  control.onopen = () => {
    sendStatus();
    sendScreens();
    syncClipboardWatch();
  };
  // A pointer move is handled like a message on the control channel, unless it is older than the last one handled.
  moves.onmessage = (event) => {
    if (
      viewerId !== id ||
      peer !== connection ||
      typeof event.data !== 'string' ||
      event.data.length > 512
    )
      return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (
      message?.type !== 'pointer' ||
      message.action !== 'move' ||
      !Number.isSafeInteger(message.seq) ||
      message.seq <= lastPointer
    )
      return;
    control.onmessage({ data: event.data });
  };
  // Messages from the viewer: at most 1 MB each, 400 a second, and 100 waiting for the main process. A message over
  // those limits is refused with an error message to the viewer. Most messages are input for the main process, which
  // may answer (with the clipboard's text, for example); its answer goes back to the viewer.
  control.onmessage = async (event) => {
    if (viewerId !== id || peer !== connection) return;
    try {
      if (typeof event.data !== 'string' || event.data.length > 1024 * 1024)
        throw Error('Control message is too large.');
      const now = Date.now();
      if (now - messageWindow > 1000) {
        messageWindow = now;
        messageCount = 0;
      }
      if (++messageCount > 400 || pending > 100) throw Error('Too many input events.');
      const message = JSON.parse(event.data);
      if (message?.type === 'screen') {
        if (typeof message.id === 'string' && message.id.length <= 64) switchScreen(message.id);
        return;
      }
      // The viewer's clipboard, sent on its own; it lands here only as the clipboard setting allows.
      if (message?.type === 'clipboard-auto') {
        if (clipboardToHere() && typeof message.text === 'string' && message.text.length <= 60000)
          await api.input(id, { type: 'clipboard-set', text: message.text });
        return;
      }
      if (
        ['pointer', 'double-click'].includes(message?.type) &&
        Number.isSafeInteger(message.seq)
      ) {
        if (message.action === 'move' && message.seq <= lastPointer) return;
        lastPointer = Math.max(lastPointer, message.seq);
      }
      pending++;
      const response = await api.input(id, message);
      pending = Math.max(0, pending - 1);
      if (viewerId === id && control.readyState === 'open' && response) {
        // Clipboard text travels in one message, so more than 60 KB of it has to go as a file.
        if (
          response.type === 'clipboard' &&
          new TextEncoder().encode(response.text).length > 60000
        ) {
          control.send(
            JSON.stringify({
              type: 'error',
              message: 'Use a file for clipboard text larger than 60 KB.',
            }),
          );
        } else control.send(JSON.stringify(response));
      }
    } catch (error) {
      pending = Math.max(0, pending - 1);
      if (control.readyState === 'open')
        control.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  };
  connection.onicecandidate = (event) => {
    if (viewerId === id)
      api.signal(id, { type: 'ice', candidate: event.candidate?.toJSON() || null });
  };
  connection.onconnectionstatechange = () => {
    if (peer !== connection) return;
    if (connection.connectionState === 'connected') {
      $('viewer').textContent = `Connected · ${address}`;
      $('send-file').disabled = false;
      $('disconnect').disabled = false;
      notice('Your paired viewer can see and control this display.');
      connected = true;
      syncMood();
    } else if (['failed', 'closed'].includes(connection.connectionState)) {
      api.disconnect();
      closePeer();
      notice('The viewer connection ended.');
    } else if (connection.connectionState === 'disconnected') {
      // Possibly only for a moment: WebRTC may recover. Keys and buttons the viewer held down are let go meanwhile.
      api.release();
      $('viewer').textContent = 'Viewer connection interrupted';
      connected = false;
      syncMood();
    }
  };
  $('viewer').textContent = `Connecting · ${address}`;
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  if (viewerId === id)
    await api.signal(id, { type: 'offer', sdp: connection.localDescription.toJSON() });
}

/**
 * Closes the viewer's connection, if there is one, and lets go of any key or button it held down. Sharing goes on,
 * waiting for the next viewer.
 */
function closePeer() {
  api.watchClipboard(false).catch(() => {});
  const old = peer;
  peer = null;
  channel = null;
  viewerId = null;
  ice = [];
  pending = 0;
  connected = false;
  if (old) {
    old.onconnectionstatechange = null;
    old.close();
  }
  api.release().catch(() => {});
  $('viewer').textContent = 'No viewer connected';
  $('send-file').disabled = true;
  $('disconnect').disabled = true;
  syncMood();
}

/**
 * Tells the viewer what this side offers: whether the sound is shared, whether it may control this computer, and
 * the clipboard setting. Sent when the control channel opens and whenever one of these changes.
 */
function sendStatus() {
  if (channel?.readyState !== 'open' || !media) return;
  channel.send(
    JSON.stringify({
      type: 'status',
      audio: media.getAudioTracks().some((track) => track.readyState === 'live'),
      input: controlAvailable(info.permissions),
      clipboard: clipboardMode(),
    }),
  );
}

/** Whether the viewer may control this computer. In a Wayland session that takes the desktop's approval. */
function controlAvailable(permissions) {
  return permissions.wayland
    ? permissions.remote === 'allowed'
    : permissions.native && permissions.input;
}

/** Connects the main process's signaling and the sharing card's viewer buttons. Called once by start.js. */
function setUpViewerConnection() {
  // The viewer's answer and its network candidates. Candidates that arrive before the answer wait for it.
  api.onSignal(async ({ id, message }) => {
    if (id !== viewerId || !peer) return;
    try {
      if (message.type === 'answer') {
        await peer.setRemoteDescription(message.sdp);
        for (const candidate of ice) await peer.addIceCandidate(candidate);
        ice = [];
      } else if (message.type === 'ice') {
        if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
        else ice.push(message.candidate);
      }
    } catch (error) {
      notice(`Connection error: ${error.message}`, true);
      await api.disconnect();
      closePeer();
    }
  });
  $('disconnect').onclick = () => {
    api.disconnect();
    closePeer();
    notice('Viewer disconnected.');
  };
  // A file chosen on this computer, for the viewer to download.
  $('send-file').onclick = async () => {
    try {
      const name = await api.sendFile();
      if (name) notice(`Sent ${name}`);
    } catch (error) {
      notice(reason(error), true);
    }
  };
}
