'use strict';
// Starts the main window. This script runs last, once the others have declared everything, and does, in order:
//  1. gives the page the colors of the saved mode, night or day;
//  2. connects the page's buttons and the main process's events;
//  3. draws the page;
//  4. asks the main process about this computer, and fills in what depends on it.
// Once the page has loaded, the main process calls window.autoShare(), which starts sharing unless Settings turned
// that off.

applyPageTheme(theme);

// --- Buttons and events ---------------------------------------------------------------------------------------

setUpPages();
setUpThemeSwitch();
setUpDeviceList();
setUpConnecting();
setUpAddDialog();
setUpSharing();
setUpViewerConnection();
setUpClipboard();
setUpSettings();

// What the main process reports while the window is open.
api.onEvent((event) => {
  // A viewer signed in. It replaces the viewer before, if there was one.
  if (event.type === 'viewer-joined') {
    newViewer(event.id, event.address)
      .then(() => {
        if (event.replaced)
          notice(`${event.address} connected and took over from the previous viewer.`);
      })
      .catch((error) => {
        notice(error.message, true);
        api.disconnect();
        closePeer();
      });
  }
  if (event.type === 'viewer-left' && event.id === viewerId) closePeer();
  // A screen was added, removed or changed.
  if (event.type === 'screens') refreshScreens().catch(() => {});
  // Windows: the shape this computer's cursor has, for the viewer's own pointer (src/main/control/cursor-win.cjs).
  if (event.type === 'cursor' && channel?.readyState === 'open')
    channel.send(JSON.stringify({ type: 'cursor', shape: event.shape }));
  // Copied on this computer, for the viewer's clipboard; more than fits in one message stays here.
  if (
    event.type === 'clipboard' &&
    channel?.readyState === 'open' &&
    clipboardFromHere() &&
    typeof event.text === 'string' &&
    new TextEncoder().encode(event.text).length <= 60000
  )
    channel.send(JSON.stringify({ type: 'clipboard-auto', text: event.text }));
  if (event.type === 'error' || event.type === 'notice')
    notice(event.message, event.type === 'error');
  // Linux: recording the system's sound failed or stopped.
  if (event.type === 'audio-error') {
    clearInterval(audioTimer);
    $('audio-status').textContent = 'Audio unavailable';
    notice(event.message, true);
    media?.getAudioTracks().forEach((track) => track.stop());
  }
  if (event.type === 'stopped') closePeer();
  // The computers this one is connected to, for their cards and the cat's mood.
  if (event.type === 'connected') {
    connectedKeys = new Set(event.keys || []);
    renderDevices();
    syncMood();
  }
  // Android devices reached through adb changed; the Add device dialog's Cable tab follows them.
  if (event.type === 'android') {
    androidDevices = Array.isArray(event.devices) ? event.devices : [];
    renderDevices();
    if ($('add-dialog').open && addKind === 'android') renderPairUsb();
  }
  if (event.type === 'android-pairing') onPairing(event);
  // Android devices sharing through the app (general mode), and the devices whose window is open.
  if (event.type === 'android-sharing') {
    androidSharing = Array.isArray(event.devices) ? event.devices : [];
    renderDevices();
  }
  if (event.type === 'android-connected') {
    androidConnected = new Set(event.ids || []);
    renderDevices();
  }
  // Wayland: the desktop allowed or refused remote control, so the permissions and the viewer's status change.
  if (event.type === 'remote-control')
    api
      .info()
      .then((value) => {
        info = value;
        renderPermissions(info.permissions);
        sendStatus();
      })
      .catch(() => {});
  // A session window opened from here, to another computer or an Android device, closed or lost its connection.
  if (event.type === 'viewer-ended') showEnded(event);
});

// --- The page as it opens -------------------------------------------------------------------------------------

document.body.classList.add(`platform-${api.platform}`, 'desktop');
PixelIcons.render();
renderThemeToggle();
house = PixelHome.mount($('house-art'), {
  container: $('house'),
  mode: theme,
  onLight: onHouseLight,
  measure: () => ({
    width: $('house').clientWidth,
    height: $('house').clientHeight,
    roofTop: $('house-sky').offsetHeight,
    streetTop: $('house-street').offsetTop,
  }),
});
renderAudio();
renderDevices();
renderTrusted();
renderCredentials();
renderAutoShare();
refreshScreens().catch(() => {});
// Every listed computer is checked every 5 seconds, so one that stops sharing drops out quickly.
setInterval(probeAll, 5000);
renderClipboardSetting();

// --- This computer, as the main process sees it ---------------------------------------------------------------

const ready = api
  .info()
  .then((value) => {
    info = value;
    $('hostname').textContent = info.name;
    $('version').textContent = `v${info.version}`;
    $('about-version').textContent = info.version;
    $('account-name').textContent = info.account || 'this computer’s account';
    discovered = info.devices || [];
    discoveryError = info.discoveryError || '';
    connectedKeys = new Set(info.connected || []);
    syncMood();
    androidDevices = info.android?.devices || [];
    androidSharing = info.android?.sharing || [];
    androidConnected = new Set(info.android?.connected || []);
    renderNetworks();
    $('start').disabled = !info.addresses.length;
    if (!info.addresses.length) notice('Join a private IPv4 network to start sharing.');
    renderPermissions(info.permissions);
    renderNetworkPill();
    renderDevices();
    probeAll();
  })
  .catch((error) => notice(reason(error), true));

// The main process calls this once the page loads. Sharing starts on its own unless Settings turns it off.
window.autoShare = async () => {
  await ready;
  if (!autoShareWanted || media || $('start').hidden) return;
  // Opened before the network was up, as at login: sharing starts once a network appears.
  if (!info?.addresses.length) {
    resumeSharing = true;
    return;
  }
  if (!$('start').disabled) start();
};
renderRecentsFirst();
api
  .loginItem()
  .then(renderLogin)
  .catch(() => {});
// Networks come and go; sharing follows them.
setInterval(followNetworks, 5000);
